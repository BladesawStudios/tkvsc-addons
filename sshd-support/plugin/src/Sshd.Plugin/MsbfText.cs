using System.Globalization;
using System.Text;
using MsbtSharp;

namespace Tkvsc.Sshd;

/// <summary>
/// MSBF message flows as editable text. Header fields and section layout aren't shown; writing keeps the original file's, so
/// only entry points, nodes and branch targets change. The text is YAML, but it's read by this class, not a YAML parser.
/// </summary>
/// <remarks>
/// A branch lists its targets inline, and the shared branch table is rebuilt from them in node order. In every MSBF in the game
/// the table is laid out exactly that way, so an unedited file writes back the same bytes.
/// </remarks>
public static class MsbfText
{
    private const string None = "-";

    private static readonly string Header =
        """
        # Skyward Sword HD message flow.
        # Nodes are numbered from 0. next and targets name a node, or - for none.
        # Omitted fields are 0; an omitted sub is 255 for entry and message nodes.

        """;

    public static string ToText(MsbfFile file)
    {
        StringBuilder text = new(Header);

        text.Append("\nentries:\n");
        foreach (MsbLabel entry in file.EntryPoints)
            text.Append("  ").Append(entry.Name).Append(": ").Append(entry.Index.ToString(CultureInfo.InvariantCulture)).Append('\n');

        text.Append("\nnodes:\n");
        for (int i = 0; i < file.Nodes.Count; i++)
        {
            MsbfNode node = file.Nodes[i];
            List<string> fields = [$"type: {TypeName(node.Type)}"];
            bool branch = node.Type == MsbfNodeType.Branch;

            if (node.SubType != DefaultSubType(node.Type)) fields.Add($"sub: {node.SubType}");
            if (!branch || node.Next != MsbfNode.None) fields.Add($"next: {NodeRef(node.Next)}");
            AddIfSet(fields, "p1", node.Param1);
            AddIfSet(fields, "p2", node.Param2);
            AddIfSet(fields, "p3", node.Param3);
            if (branch)
            {
                fields.Add($"targets: [{string.Join(", ", file.BranchTargets(node).Select(NodeRef))}]");
            }
            else
            {
                AddIfSet(fields, "p4", node.Param4);
                AddIfSet(fields, "p5", node.Param5);
            }
            AddIfSet(fields, "pad", node.Padding);

            text.Append("  ").Append(i.ToString(CultureInfo.InvariantCulture)).Append(": {").Append(string.Join(", ", fields)).Append("}\n");
        }

        return text.ToString();
    }

    /// <summary>Replaces the entry points, nodes and branch table of <paramref name="file"/> with those in <paramref name="text"/>.</summary>
    public static void Apply(MsbfFile file, string text)
    {
        List<MsbLabel> entries = [];
        List<(MsbfNode Node, List<ushort>? Targets, int Line)> nodes = [];
        string? section = null;

        string[] lines = text.TrimStart('﻿').Replace("\r\n", "\n").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            int number = i + 1;
            string line = lines[i];
            string trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;

            if (!char.IsWhiteSpace(line[0]))
            {
                section = trimmed switch
                {
                    "entries:" => "entries",
                    "nodes:" => "nodes",
                    _ => throw Error(number, $"expected 'entries:' or 'nodes:', not '{trimmed}'."),
                };
                continue;
            }

            switch (section)
            {
                case "entries":
                    entries.Add(ParseEntry(trimmed, number));
                    break;
                case "nodes":
                    nodes.Add(ParseNode(trimmed, nodes.Count, number));
                    break;
                default:
                    throw Error(number, "is indented but isn't under 'entries:' or 'nodes:'.");
            }
        }

        Validate(entries, nodes);

        file.EntryPoints.Clear();
        file.EntryPoints.AddRange(entries);
        file.Nodes.Clear();
        file.Branches.Clear();
        foreach ((MsbfNode node, List<ushort>? targets, int line) in nodes)
        {
            if (targets is not null)
            {
                if (file.Branches.Count + targets.Count > ushort.MaxValue) throw Error(line, "the branch table is full.");
                node.Param4 = (ushort)targets.Count;
                node.Param5 = (ushort)file.Branches.Count;
                file.Branches.AddRange(targets);
            }
            file.Nodes.Add(node);
        }
    }

    private static MsbLabel ParseEntry(string line, int number)
    {
        int colon = line.LastIndexOf(": ", StringComparison.Ordinal);
        if (colon <= 0) throw Error(number, "should be 'Label: node'.");
        string name = line[..colon].Trim();
        if (Encoding.UTF8.GetByteCount(name) > byte.MaxValue) throw Error(number, $"the label '{name}' is longer than 255 bytes.");
        return new MsbLabel(name, ParseNumber(line[(colon + 2)..].Trim(), number, "entry node"));
    }

    private static (MsbfNode, List<ushort>?, int) ParseNode(string line, int expected, int number)
    {
        int colon = line.IndexOf(':');
        if (colon <= 0) throw Error(number, "should be 'N: {type: ..., ...}'.");
        int index = ParseNumber(line[..colon].Trim(), number, "node number");
        if (index != expected) throw Error(number, $"is node {index}, but node {expected} comes next. Nodes are numbered from 0 in order.");

        string body = line[(colon + 1)..].Trim();
        if (body.Length < 2 || body[0] != '{' || body[^1] != '}') throw Error(number, "the node's fields should be in { }.");

        Dictionary<string, string> fields = SplitFields(body[1..^1], number);
        if (!fields.TryGetValue("type", out string? typeText)) throw Error(number, "the node has no type.");
        MsbfNodeType type = ParseType(typeText, number);
        bool branch = type == MsbfNodeType.Branch;

        MsbfNode node = new()
        {
            Type = type,
            SubType = fields.TryGetValue("sub", out string? sub) ? (byte)ParseRange(sub, number, "sub", byte.MaxValue) : DefaultSubType(type),
            Next = fields.TryGetValue("next", out string? next) ? ParseRef(next, number, "next") : MsbfNode.None,
            Param1 = Field(fields, "p1", number),
            Param2 = Field(fields, "p2", number),
            Param3 = Field(fields, "p3", number),
            Padding = Field(fields, "pad", number),
        };

        List<ushort>? targets = null;
        if (branch)
        {
            if (fields.ContainsKey("p4") || fields.ContainsKey("p5")) throw Error(number, "a branch's p4 and p5 come from its targets; list those instead.");
            if (!fields.TryGetValue("targets", out string? list)) throw Error(number, "a branch needs targets: [...].");
            targets = ParseTargets(list, number);
        }
        else
        {
            if (fields.ContainsKey("targets")) throw Error(number, "only branch nodes have targets.");
            node.Param4 = Field(fields, "p4", number);
            node.Param5 = Field(fields, "p5", number);
        }

        string[] known = ["type", "sub", "next", "p1", "p2", "p3", "p4", "p5", "pad", "targets"];
        if (fields.Keys.FirstOrDefault(key => !known.Contains(key)) is { } unknown) throw Error(number, $"unknown field '{unknown}'.");
        return (node, targets, number);
    }

    // Splits "a: 1, b: [2, 3]" into fields, keeping commas inside [ ].
    private static Dictionary<string, string> SplitFields(string body, int number)
    {
        Dictionary<string, string> fields = new(StringComparer.Ordinal);
        int depth = 0, start = 0;
        for (int i = 0; i <= body.Length; i++)
        {
            if (i < body.Length)
            {
                if (body[i] == '[') depth++;
                else if (body[i] == ']') depth--;
                if (depth < 0) throw Error(number, "has a ']' without a '['.");
                if (body[i] != ',' || depth > 0) continue;
            }
            else if (depth != 0)
            {
                throw Error(number, "has a '[' without a ']'.");
            }

            string part = body[start..i].Trim();
            start = i + 1;
            if (part.Length == 0) continue;
            int colon = part.IndexOf(':');
            if (colon <= 0) throw Error(number, $"'{part}' should be 'name: value'.");
            string key = part[..colon].Trim();
            if (!fields.TryAdd(key, part[(colon + 1)..].Trim())) throw Error(number, $"'{key}' is given twice.");
        }
        return fields;
    }

    private static List<ushort> ParseTargets(string list, int number)
    {
        if (list.Length < 2 || list[0] != '[' || list[^1] != ']') throw Error(number, "targets should be a list like [3, 7].");
        string inner = list[1..^1].Trim();
        return inner.Length == 0 ? [] : [.. inner.Split(',').Select(target => ParseRef(target.Trim(), number, "target"))];
    }

    private static void Validate(List<MsbLabel> entries, List<(MsbfNode Node, List<ushort>? Targets, int Line)> nodes)
    {
        string? duplicate = entries.GroupBy(e => e.Name).FirstOrDefault(g => g.Count() > 1)?.Key;
        if (duplicate is not null) throw new FormatException($"The entry '{duplicate}' is listed twice.");
        if (entries.FirstOrDefault(e => e.Index >= nodes.Count) is { } entry)
            throw new FormatException($"The entry '{entry.Name}' points at node {entry.Index}, but there are {nodes.Count} nodes.");

        foreach ((MsbfNode node, List<ushort>? targets, int line) in nodes)
        {
            if (node.Next != MsbfNode.None && node.Next >= nodes.Count) throw Error(line, $"next is node {node.Next}, but there are {nodes.Count} nodes.");
            foreach (ushort target in targets ?? [])
            {
                if (target != MsbfNode.None && target >= nodes.Count) throw Error(line, $"target {target} doesn't exist; there are {nodes.Count} nodes.");
            }
        }
    }

    private static string TypeName(MsbfNodeType type) => type switch
    {
        MsbfNodeType.Message => "message",
        MsbfNodeType.Branch => "branch",
        MsbfNodeType.Event => "event",
        MsbfNodeType.Entry => "entry",
        _ => ((byte)type).ToString(CultureInfo.InvariantCulture),
    };

    private static MsbfNodeType ParseType(string text, int number) => text switch
    {
        "message" => MsbfNodeType.Message,
        "branch" => MsbfNodeType.Branch,
        "event" => MsbfNodeType.Event,
        "entry" => MsbfNodeType.Entry,
        _ when byte.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out byte raw) => (MsbfNodeType)raw,
        _ => throw Error(number, $"unknown node type '{text}'; use message, branch, event, entry or a number."),
    };

    private static byte DefaultSubType(MsbfNodeType type) => type is MsbfNodeType.Message or MsbfNodeType.Entry ? byte.MaxValue : (byte)0;

    private static void AddIfSet(List<string> fields, string name, ushort value)
    {
        if (value != 0) fields.Add($"{name}: {value.ToString(CultureInfo.InvariantCulture)}");
    }

    private static string NodeRef(ushort node) => node == MsbfNode.None ? None : node.ToString(CultureInfo.InvariantCulture);

    private static ushort ParseRef(string text, int number, string what)
        => text == None ? MsbfNode.None : (ushort)ParseRange(text, number, what, MsbfNode.None - 1);

    private static ushort Field(Dictionary<string, string> fields, string name, int number)
        => fields.TryGetValue(name, out string? text) ? (ushort)ParseRange(text, number, name, ushort.MaxValue) : (ushort)0;

    private static int ParseRange(string text, int number, string what, int max)
    {
        int value = ParseNumber(text, number, what);
        return value <= max ? value : throw Error(number, $"{what} is {value}, more than {max}.");
    }

    private static int ParseNumber(string text, int number, string what)
    {
        bool hex = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        return int.TryParse(hex ? text[2..] : text, hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None, CultureInfo.InvariantCulture, out int value)
            ? value
            : throw Error(number, $"{what} '{text}' isn't a number.");
    }

    private static FormatException Error(int line, string message) => new($"Line {line}: {message}");
}

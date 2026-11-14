using System.Globalization;
using System.Text;
using JParticleSharp;

namespace Tkvsc.Sshd;

/// <summary>
/// JPA name tables (<c>.jpn</c>) as text: the table's length, then each entry that isn't 0xFFFF (none) as <c>index: value</c>.
/// </summary>
public static class JpnText
{
    private const ushort None = 0xFFFF;

    private static readonly string Header =
        """
        # Skyward Sword HD particle table (.jpn), the .jpc beside it has the resources.
        # Entries not listed are 0xFFFF (none). count is the table's length.

        """;

    public static string ToText(JpnFile file)
    {
        StringBuilder text = new(Header);
        text.Append("\ncount: ").Append(file.Entries.Count).Append("\nentries:\n");
        for (int i = 0; i < file.Entries.Count; i++)
            if (file.Entries[i] != None) text.Append("  ").Append(i).Append(": ").Append(file.Entries[i]).Append('\n');
        return text.ToString();
    }

    public static JpnFile Parse(string text)
    {
        int? count = null;
        SortedDictionary<int, ushort> entries = [];
        bool inEntries = false;

        string[] lines = text.TrimStart('﻿').Replace("\r\n", "\n").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            int number = i + 1;
            string line = lines[i];
            string trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;

            int colon = trimmed.IndexOf(':');
            if (colon <= 0) throw Error(number, "should be 'name: value'.");
            string key = trimmed[..colon].Trim(), value = trimmed[(colon + 1)..].Trim();

            if (!char.IsWhiteSpace(line[0]))
            {
                inEntries = false;
                switch (key)
                {
                    case "count": count = Number(value, number, "count", ushort.MaxValue); break;
                    case "entries" when value.Length == 0: inEntries = true; break;
                    default: throw Error(number, $"expected 'count:' or 'entries:', not '{trimmed}'.");
                }
                continue;
            }

            if (!inEntries) throw Error(number, "is indented but isn't under 'entries:'.");
            int index = Number(key, number, "entry index", ushort.MaxValue - 1);
            ushort entry = (ushort)Number(value, number, "entry", ushort.MaxValue);
            if (!entries.TryAdd(index, entry)) throw Error(number, $"entry {index} is listed twice.");
        }

        if (count is null) throw new FormatException("The table has no 'count:'.");
        if (entries.Count > 0 && entries.Keys.Max() >= count) throw new FormatException($"Entry {entries.Keys.Max()} is past the table's count of {count}.");

        JpnFile file = new();
        for (int i = 0; i < count; i++) file.Entries.Add(entries.GetValueOrDefault(i, None));
        return file;
    }

    private static int Number(string text, int line, string what, int max)
        => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out int value) && value <= max
            ? value
            : throw Error(line, $"{what} '{text}' isn't a number from 0 to {max}.");

    private static FormatException Error(int line, string message) => new($"Line {line}: {message}");
}

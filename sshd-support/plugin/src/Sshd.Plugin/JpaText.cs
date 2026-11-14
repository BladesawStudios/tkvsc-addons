using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using JParticleSharp;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace Tkvsc.Sshd;

/// <summary>
/// JPA particle containers (<c>.jpc</c>) as YAML: one entry per emitter resource, with every byte of every block as a named
/// field, so resources can be edited, added, removed or copied. Block offsets follow JParticleSharp's typed views; the few
/// bytes those don't name are shown as <c>unknownXX</c>. Textures are listed in a comment and always kept from the original.
/// </summary>
public static class JpaText
{
    private enum Kind { U8, S8, U8Hex, U16, S16, U16Hex, U32Hex, F32, Color }

    // Offsets are from the block start, header included, as in JParticleSharp.
    private sealed record Field(string Name, int At, Kind Kind, int Count = 1, bool Always = false)
    {
        public int Size => Count * Kind switch { Kind.U8 or Kind.S8 or Kind.U8Hex => 1, Kind.U16 or Kind.S16 or Kind.U16Hex => 2, _ => 4 };
    }

    private sealed record BlockSpec(string Magic, string Key, int Size, Field[] Fields);

    private static readonly BlockSpec Emitter = new("BEM1", "emitter", 0x7C,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("unknown0C", 0x0C, Kind.U32Hex),
        new("scale", 0x10, Kind.F32, 3), new("translation", 0x1C, Kind.F32, 3), new("direction", 0x28, Kind.F32, 3),
        new("initialVelocityOmni", 0x34, Kind.F32), new("initialVelocityAxis", 0x38, Kind.F32), new("initialVelocityRandom", 0x3C, Kind.F32),
        new("initialVelocityDirection", 0x40, Kind.F32), new("spread", 0x44, Kind.F32), new("initialVelocityRatio", 0x48, Kind.F32),
        new("rate", 0x4C, Kind.F32), new("rateRandom", 0x50, Kind.F32), new("lifeTimeRandom", 0x54, Kind.F32), new("volumeSweep", 0x58, Kind.F32),
        new("volumeMinRadius", 0x5C, Kind.F32), new("airResistance", 0x60, Kind.F32), new("momentRandom", 0x64, Kind.F32),
        new("rotation", 0x68, Kind.S16, 3), new("maxFrame", 0x6E, Kind.S16), new("startFrame", 0x70, Kind.S16), new("lifeTime", 0x72, Kind.S16),
        new("volumeSize", 0x74, Kind.S16), new("divNumber", 0x76, Kind.S16), new("rateStep", 0x78, Kind.U8),
    ]);

    private static readonly BlockSpec Field1 = new("FLD1", "fields", 0x44,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("position", 0x0C, Kind.F32, 3), new("direction", 0x18, Kind.F32, 3),
        new("param1", 0x24, Kind.F32), new("param2", 0x28, Kind.F32), new("param3", 0x2C, Kind.F32), new("fadeIn", 0x30, Kind.F32),
        new("fadeOut", 0x34, Kind.F32), new("enableTime", 0x38, Kind.F32), new("disableTime", 0x3C, Kind.F32), new("cycle", 0x40, Kind.U8),
    ]);

    // BSP1's fixed part; the table offsets (0x0C, 0x0E) and counts (0x1F, 0x22, 0x23) come from the tables after it.
    private const int BaseShapeFixed = 0x34;
    private static readonly BlockSpec BaseShape = new("BSP1", "baseShape", BaseShapeFixed,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("size", 0x10, Kind.F32, 2), new("blendMode", 0x18, Kind.U16Hex),
        new("alphaCompare", 0x1A, Kind.U8Hex), new("alphaRef0", 0x1B, Kind.U8), new("alphaRef1", 0x1C, Kind.U8), new("zMode", 0x1D, Kind.U8Hex),
        new("textureFlags", 0x1E, Kind.U8Hex), new("textureIndex", 0x20, Kind.U8), new("colorFlags", 0x21, Kind.U8Hex),
        new("colorAnimationMaxFrame", 0x24, Kind.U16), new("primaryColor", 0x26, Kind.Color, Always: true),
        new("environmentColor", 0x2A, Kind.Color, Always: true), new("animationRandom", 0x2E, Kind.U8), new("colorLoopOffsetMask", 0x2F, Kind.U8),
        new("textureIndexLoopOffsetMask", 0x30, Kind.U8),
    ]);

    private static readonly BlockSpec ExtraShape = new("ESP1", "extraShape", 0x60,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("scaleInTiming", 0x0C, Kind.F32), new("scaleOutTiming", 0x10, Kind.F32),
        new("scaleInValueX", 0x14, Kind.F32), new("scaleOutValueX", 0x18, Kind.F32), new("scaleInValueY", 0x1C, Kind.F32),
        new("scaleOutValueY", 0x20, Kind.F32), new("scaleOutRandom", 0x24, Kind.F32), new("scaleAnimationMaxFrameX", 0x28, Kind.U16),
        new("scaleAnimationMaxFrameY", 0x2A, Kind.U16), new("alphaInTiming", 0x2C, Kind.F32), new("alphaOutTiming", 0x30, Kind.F32),
        new("alphaInValue", 0x34, Kind.F32), new("alphaBaseValue", 0x38, Kind.F32), new("alphaOutValue", 0x3C, Kind.F32),
        new("alphaWaveFrequency", 0x40, Kind.F32), new("alphaWaveRandom", 0x44, Kind.F32), new("alphaWaveAmplitude", 0x48, Kind.F32),
        new("rotateAngle", 0x4C, Kind.F32), new("rotateAngleRandom", 0x50, Kind.F32), new("rotateSpeed", 0x54, Kind.F32),
        new("rotateSpeedRandom", 0x58, Kind.F32), new("rotateDirection", 0x5C, Kind.F32),
    ]);

    private static readonly BlockSpec ChildShape = new("SSP1", "childShape", 0x48,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("positionRandom", 0x0C, Kind.F32), new("baseVelocity", 0x10, Kind.F32),
        new("baseVelocityRandom", 0x14, Kind.F32), new("velocityInfluenceRate", 0x18, Kind.F32), new("gravity", 0x1C, Kind.F32),
        new("globalScale", 0x20, Kind.F32, 2), new("inheritScaleRate", 0x28, Kind.F32), new("inheritAlphaRate", 0x2C, Kind.F32),
        new("inheritRgbRate", 0x30, Kind.F32), new("primaryColor", 0x34, Kind.Color, Always: true), new("environmentColor", 0x38, Kind.Color, Always: true),
        new("timing", 0x3C, Kind.F32), new("life", 0x40, Kind.U16), new("rate", 0x42, Kind.U16), new("step", 0x44, Kind.U8),
        new("textureIndex", 0x45, Kind.U8), new("rotateSpeed", 0x46, Kind.U16),
    ]);

    private static readonly BlockSpec ExtraTexture = new("ETX1", "extraTexture", 0x50,
    [
        new("flags", 0x08, Kind.U32Hex, Always: true), new("indirectMatrix", 0x0C, Kind.F32, 6), new("unknown24", 0x24, Kind.F32, 10),
        new("unknown4C", 0x4C, Kind.U8), new("indirectScaleExponent", 0x4D, Kind.S8), new("indirectTextureIndex", 0x4E, Kind.U8),
        new("secondTextureIndex", 0x4F, Kind.U8),
    ]);

    private static readonly string[] BlockOrder = ["BEM1", "FLD1", "KFA1", "BSP1", "ESP1", "SSP1", "ETX1", "TDB1"];
    private static readonly string[] ResourceKeys = ["id", "emitter", "fields", "keyFrames", "baseShape", "extraShape", "childShape", "extraTexture", "textures"];

    private static readonly string Header =
        """
        # Skyward Sword HD particles (JPAC2-11): one entry per emitter resource.
        # Omitted fields are 0. Colors are "#RRGGBBAA". Angles in ESP1/SSP1 are in 0x10000ths of a turn.
        # baseShape's tables need their flags: textureScroll (flags bit 26), textureIndexAnimation (textureFlags bit 0),
        # primaryColors (colorFlags bit 1) and environmentColors (colorFlags bit 3).
        # unknownXX fields are bytes nothing names yet. Textures can't be edited here; open the file with
        # "Skyward Sword HD Textures" to see them.

        """;

    // ---- to text ----------------------------------------------------------

    public static string ToText(JpacFile file)
    {
        StringBuilder text = new(Header);
        text.Append("# textures:\n");
        for (int i = 0; i < file.Textures.Count; i++) text.Append("#   ").Append(i).Append(": ").Append(file.Textures[i].Name).Append('\n');

        text.Append("\nresources:\n");
        foreach (JpaResource resource in file.Resources)
        {
            text.Append("  - id: ").Append(resource.Id).Append('\n');
            foreach (JpaBlock block in resource.Blocks)
            {
                switch (block.Magic)
                {
                    case "BEM1": WriteBlock(text, Emitter, block, 4, Comment(new JpaDynamics(block))); break;
                    case "FLD1": WriteListBlock(text, Field1, block, resource.Blocks, Comment(new JpaField(block))); break;
                    case "KFA1": WriteKeyFrames(text, block, resource.Blocks); break;
                    case "BSP1": WriteBaseShape(text, block); break;
                    case "ESP1": WriteBlock(text, ExtraShape, block, 4, null); break;
                    case "SSP1": WriteBlock(text, ChildShape, block, 4, null); break;
                    case "ETX1": WriteBlock(text, ExtraTexture, block, 4, null); break;
                    case "TDB1":
                        text.Append("    textures: [").Append(string.Join(", ", resource.TextureIndices)).Append("]\n");
                        break;
                    default:
                        throw new InvalidDataException($"Resource {resource.Id} has a {block.Magic} block, which this editor doesn't know.");
                }
            }
        }
        return text.ToString();
    }

    private static void WriteBlock(StringBuilder text, BlockSpec spec, JpaBlock block, int indent, string? comment, bool listItem = false)
    {
        string pad = new(' ', indent);
        if (listItem) text.Append(pad).Append("  -");
        else text.Append(pad).Append(spec.Key).Append(':');
        if (comment is not null) text.Append("  # ").Append(comment);
        text.Append('\n');

        bool first = true;
        string fieldPad = new(' ', indent + (listItem ? 4 : 2));
        foreach (Field field in spec.Fields)
        {
            string? value = Format(block.Body, field);
            if (value is null) continue;
            text.Append(listItem && first ? new string(' ', indent + 4) : fieldPad).Append(field.Name).Append(": ").Append(value).Append('\n');
            first = false;
        }
    }

    private static void WriteListBlock(StringBuilder text, BlockSpec spec, JpaBlock block, List<JpaBlock> blocks, string? comment)
    {
        if (blocks.First(b => b.Magic == spec.Magic) == block) text.Append("    ").Append(spec.Key).Append(":\n");
        WriteBlock(text, spec, block, 4, comment, listItem: true);
    }

    private static void WriteKeyFrames(StringBuilder text, JpaBlock block, List<JpaBlock> blocks)
    {
        if (blocks.First(b => b.Magic == "KFA1") == block) text.Append("    keyFrames:\n");
        JpaKeyFrames view = new(block);
        text.Append("      - type: ").Append(Enum.IsDefined(view.KeyType) ? view.KeyType.ToString() : ((byte)view.KeyType).ToString()).Append('\n');
        text.Append("        loop: ").Append(block.Body[3]).Append('\n');
        if (block.Body[2] != 0) text.Append("        unknown0A: ").Append(block.Body[2]).Append('\n');
        text.Append("        keys:  # [time, value, tangentIn, tangentOut]\n");
        foreach (JpaKey key in view.Keys)
            text.Append("          - [").Append(F(key.Time)).Append(", ").Append(F(key.Value)).Append(", ").Append(F(key.TangentIn)).Append(", ").Append(F(key.TangentOut)).Append("]\n");
    }

    private static void WriteBaseShape(StringBuilder text, JpaBlock block)
    {
        JpaBaseShape view = new(block);
        WriteBlock(text, BaseShape, block, 4, Comment(view));
        if (view.TextureScroll is { } scroll)
            text.Append("      textureScroll: [").Append(string.Join(", ", scroll.Select(F))).Append("]  # translate x/y, scale x/y, rotate, then per frame\n");
        if (view.TextureIndexAnimation)
            text.Append("      textureIndexAnimation: [").Append(string.Join(", ", view.TextureIndexAnimationTable)).Append("]\n");
        WriteColors(text, "primaryColors", view.PrimaryColorAnimation, view.PrimaryColorTable);
        WriteColors(text, "environmentColors", view.EnvironmentColorAnimation, view.EnvironmentColorTable);
    }

    private static void WriteColors(StringBuilder text, string name, bool enabled, IReadOnlyList<JpaColorKey> keys)
    {
        if (!enabled) return;
        text.Append("      ").Append(name).Append(":  # [frame, color]\n");
        foreach (JpaColorKey key in keys) text.Append("        - [").Append(key.Time).Append(", \"#").Append(key.Rgba.ToString("X8")).Append("\"]\n");
    }

    private static string? Format(byte[] body, Field field)
    {
        string[] values = new string[field.Count];
        bool zero = true;
        int step = field.Size / field.Count;
        for (int i = 0; i < field.Count; i++)
        {
            Span<byte> at = body.AsSpan(field.At - 8 + i * step, step);
            if (at.IndexOfAnyExcept((byte)0) >= 0) zero = false;
            values[i] = field.Kind switch
            {
                Kind.U8 => at[0].ToString(CultureInfo.InvariantCulture),
                Kind.S8 => ((sbyte)at[0]).ToString(CultureInfo.InvariantCulture),
                Kind.U8Hex => "0x" + at[0].ToString("X2"),
                Kind.U16 => BinaryPrimitives.ReadUInt16BigEndian(at).ToString(CultureInfo.InvariantCulture),
                Kind.S16 => BinaryPrimitives.ReadInt16BigEndian(at).ToString(CultureInfo.InvariantCulture),
                Kind.U16Hex => "0x" + BinaryPrimitives.ReadUInt16BigEndian(at).ToString("X4"),
                Kind.U32Hex => "0x" + BinaryPrimitives.ReadUInt32BigEndian(at).ToString("X8"),
                Kind.F32 => F(BinaryPrimitives.ReadSingleBigEndian(at)),
                Kind.Color => "\"#" + BinaryPrimitives.ReadUInt32BigEndian(at).ToString("X8") + "\"",
                _ => throw new ArgumentOutOfRangeException(nameof(field)),
            };
        }
        if (zero && !field.Always) return null;
        return field.Count == 1 ? values[0] : "[" + string.Join(", ", values) + "]";
    }

    private static string F(float value) => value.ToString("R", CultureInfo.InvariantCulture);

    private static string Comment(JpaDynamics v) => $"volume type {v.VolumeType}";

    private static string Comment(JpaField v) => Enum.IsDefined(v.Type) ? $"{v.Type.ToString().ToLowerInvariant()}, add type {v.AddType}" : $"field type {(int)v.Type}";

    private static string Comment(JpaBaseShape v)
        => $"shape {v.ShapeType}, dir {v.DirType}, rot {v.RotType}, plane {v.PlaneType}";

    // ---- from text --------------------------------------------------------

    /// <summary>Replaces the resources of <paramref name="file"/> with those in <paramref name="text"/>; its textures stay.</summary>
    public static void Apply(JpacFile file, string text)
    {
        YamlStream yaml = [];
        try
        {
            yaml.Load(new StringReader(text.TrimStart('﻿')));
        }
        catch (YamlException e)
        {
            throw new FormatException($"Line {e.Start.Line}: {e.InnerException?.Message ?? e.Message}", e);
        }

        if (yaml.Documents.Count == 0 || yaml.Documents[0].RootNode is not YamlMappingNode root)
            throw new FormatException("Expected 'resources:' at the top.");
        foreach (var (key, _) in root.Children)
            if (Name(key) != "resources") throw Error(key, $"unknown key '{Name(key)}'; the file has only 'resources:'.");
        if (!root.Children.TryGetValue(new YamlScalarNode("resources"), out YamlNode? list) || list is not YamlSequenceNode resources)
            throw Error(root, "'resources:' should be a list of resources.");

        List<JpaResource> parsed = [];
        HashSet<ushort> ids = [];
        foreach (YamlNode node in resources)
        {
            JpaResource resource = ParseResource(node, file.Textures.Count);
            if (!ids.Add(resource.Id)) throw Error(node, $"resource id {resource.Id} is used twice.");
            parsed.Add(resource);
        }

        file.Resources.Clear();
        file.Resources.AddRange(parsed);
    }

    private static JpaResource ParseResource(YamlNode node, int textureCount)
    {
        if (node is not YamlMappingNode map) throw Error(node, "a resource should be a mapping with id: and its blocks.");
        foreach (var (key, _) in map.Children)
            if (!ResourceKeys.Contains(Name(key))) throw Error(key, $"unknown resource key '{Name(key)}'; use {string.Join(", ", ResourceKeys)}.");

        JpaResource resource = new() { Id = (ushort)Integer(Get(map, "id") ?? throw Error(map, "the resource has no id."), "id", 0, ushort.MaxValue) };
        Dictionary<string, List<JpaBlock>> blocks = [];
        void Add(JpaBlock block)
        {
            if (!blocks.TryGetValue(block.Magic, out var list)) blocks[block.Magic] = list = [];
            list.Add(block);
        }

        if (Get(map, "emitter") is { } emitter) Add(ParseBlock(Emitter, emitter));
        if (Get(map, "fields") is { } fields)
            foreach (YamlNode field in Sequence(fields, "fields")) Add(ParseBlock(Field1, field));
        if (Get(map, "keyFrames") is { } keyFrames)
            foreach (YamlNode keyFrame in Sequence(keyFrames, "keyFrames")) Add(ParseKeyFrames(keyFrame));
        if (Get(map, "baseShape") is { } baseShape) Add(ParseBaseShape(baseShape));
        if (Get(map, "extraShape") is { } extraShape) Add(ParseBlock(ExtraShape, extraShape));
        if (Get(map, "childShape") is { } childShape) Add(ParseBlock(ChildShape, childShape));
        if (Get(map, "extraTexture") is { } extraTexture) Add(ParseBlock(ExtraTexture, extraTexture));

        if (Get(map, "textures") is { } textures)
        {
            List<int> indices = [.. Sequence(textures, "textures").Select(t => (int)Integer(t, "texture", 0, ushort.MaxValue))];
            if (indices.FirstOrDefault(i => i >= textureCount, -1) is var bad and >= 0)
                throw Error(textures, $"texture {bad} doesn't exist; the file has {textureCount} textures.");
            if (indices.Count > byte.MaxValue) throw Error(textures, "a resource can use at most 255 textures.");
            byte[] body = new byte[(2 * indices.Count + 3) & ~3];
            for (int i = 0; i < indices.Count; i++) BinaryPrimitives.WriteUInt16BigEndian(body.AsSpan(i * 2), (ushort)indices[i]);
            Add(new JpaBlock("TDB1", body));
            resource.TextureIndexCount = (byte)indices.Count;
        }

        resource.FieldCount = (byte)(blocks.GetValueOrDefault("FLD1")?.Count ?? 0);
        resource.KeyFrameCount = (byte)(blocks.GetValueOrDefault("KFA1")?.Count ?? 0);
        foreach (string magic in BlockOrder)
            if (blocks.TryGetValue(magic, out var list)) resource.Blocks.AddRange(list);
        return resource;
    }

    private static JpaBlock ParseBlock(BlockSpec spec, YamlNode node, int size = 0, params string[] extraKeys)
    {
        if (node is not YamlMappingNode map) throw Error(node, $"{spec.Key} should be a mapping of fields.");
        foreach (var (key, _) in map.Children)
        {
            string name = Name(key);
            if (!spec.Fields.Any(f => f.Name == name) && !extraKeys.Contains(name))
                throw Error(key, $"unknown {spec.Key} field '{name}'.");
        }

        byte[] body = new byte[(size > 0 ? size : spec.Size) - 8];
        foreach (Field field in spec.Fields)
            if (Get(map, field.Name) is { } value) Put(body, field, value);
        return new JpaBlock(spec.Magic, body);
    }

    private static JpaBlock ParseKeyFrames(YamlNode node)
    {
        if (node is not YamlMappingNode map) throw Error(node, "a key frame entry should be a mapping with type:, loop: and keys:.");
        string[] known = ["type", "loop", "unknown0A", "keys"];
        foreach (var (key, _) in map.Children)
            if (!known.Contains(Name(key))) throw Error(key, $"unknown keyFrames field '{Name(key)}'.");

        YamlNode typeNode = Get(map, "type") ?? throw Error(map, "the key frames have no type.");
        string typeText = Scalar(typeNode, "type");
        byte type = Enum.TryParse(typeText, ignoreCase: false, out JpaKeyType named) && Enum.IsDefined(named)
            ? (byte)named
            : (byte)Integer(typeNode, "type", 0, byte.MaxValue, $"use a number or one of {string.Join(", ", Enum.GetNames<JpaKeyType>())}.");

        List<float[]> keys = [];
        foreach (YamlNode key in Sequence(Get(map, "keys") ?? throw Error(map, "the key frames have no keys."), "keys"))
        {
            float[] values = [.. Sequence(key, "a key").Select(v => Float(v, "a key value"))];
            if (values.Length != 4) throw Error(key, "a key is [time, value, tangentIn, tangentOut].");
            keys.Add(values);
        }
        if (keys.Count > byte.MaxValue) throw Error(map, "at most 255 keys.");

        byte[] body = new byte[4 + 16 * keys.Count];
        body[0] = type;
        body[1] = (byte)keys.Count;
        body[2] = Get(map, "unknown0A") is { } unknown ? (byte)Integer(unknown, "unknown0A", 0, byte.MaxValue) : (byte)0;
        body[3] = Get(map, "loop") is { } loop ? (byte)Integer(loop, "loop", 0, byte.MaxValue) : (byte)0;
        for (int i = 0; i < keys.Count; i++)
            for (int j = 0; j < 4; j++) BinaryPrimitives.WriteSingleBigEndian(body.AsSpan(4 + i * 16 + j * 4), keys[i][j]);
        return new JpaBlock("KFA1", body);
    }

    private static JpaBlock ParseBaseShape(YamlNode node)
    {
        string[] tables = ["textureScroll", "textureIndexAnimation", "primaryColors", "environmentColors"];
        JpaBlock fixedPart = ParseBlock(BaseShape, node, 0, tables);
        YamlMappingNode map = (YamlMappingNode)node;
        JpaBaseShape view = new(fixedPart);

        float[]? scroll = Get(map, "textureScroll") is { } s ? [.. Sequence(s, "textureScroll").Select(v => Float(v, "textureScroll"))] : null;
        byte[]? indexAnimation = Get(map, "textureIndexAnimation") is { } t ? [.. Sequence(t, "textureIndexAnimation").Select(v => (byte)Integer(v, "texture index", 0, byte.MaxValue))] : null;
        List<(ushort, uint)>? primary = Get(map, "primaryColors") is { } p ? ColorKeys(p, "primaryColors") : null;
        List<(ushort, uint)>? environment = Get(map, "environmentColors") is { } e ? ColorKeys(e, "environmentColors") : null;

        Require(map, scroll is not null, view.TextureScrollAnimation, "textureScroll", "flags bit 26 (0x04000000)");
        Require(map, indexAnimation is not null, view.TextureIndexAnimation, "textureIndexAnimation", "textureFlags bit 0 (0x01)");
        Require(map, primary is not null, view.PrimaryColorAnimation, "primaryColors", "colorFlags bit 1 (0x02)");
        Require(map, environment is not null, view.EnvironmentColorAnimation, "environmentColors", "colorFlags bit 3 (0x08)");
        if (scroll is { Length: not 10 }) throw Error(Get(map, "textureScroll")!, "textureScroll has 10 values.");
        if (indexAnimation?.Length > byte.MaxValue) throw Error(Get(map, "textureIndexAnimation")!, "at most 255 entries.");
        if (primary?.Count > byte.MaxValue || environment?.Count > byte.MaxValue) throw Error(map, "a color table has at most 255 keys.");

        static int Align(int value) => (value + 3) & ~3;
        int at = BaseShapeFixed + (scroll is null ? 0 : 0x28);
        int indexAt = at;
        at = Align(at + (indexAnimation?.Length ?? 0));
        int primaryAt = primary is null ? 0 : at;
        at = Align(at + 6 * (primary?.Count ?? 0));
        int environmentAt = environment is null ? 0 : at;
        at = Align(at + 6 * (environment?.Count ?? 0));
        if (at > ushort.MaxValue) throw Error(map, "the base shape is too big.");

        byte[] body = new byte[at - 8];
        fixedPart.Body.AsSpan(0, BaseShapeFixed - 8).CopyTo(body);
        BinaryPrimitives.WriteUInt16BigEndian(body.AsSpan(0x0C - 8), (ushort)primaryAt);
        BinaryPrimitives.WriteUInt16BigEndian(body.AsSpan(0x0E - 8), (ushort)environmentAt);
        body[0x1F - 8] = (byte)(indexAnimation?.Length ?? 0);
        body[0x22 - 8] = (byte)(primary?.Count ?? 0);
        body[0x23 - 8] = (byte)(environment?.Count ?? 0);
        if (scroll is not null)
            for (int i = 0; i < 10; i++) BinaryPrimitives.WriteSingleBigEndian(body.AsSpan(BaseShapeFixed - 8 + i * 4), scroll[i]);
        indexAnimation?.CopyTo(body, indexAt - 8);
        WriteColorKeys(body, primaryAt, primary);
        WriteColorKeys(body, environmentAt, environment);
        return new JpaBlock("BSP1", body);
    }

    private static void Require(YamlMappingNode map, bool present, bool flagged, string table, string flag)
    {
        if (present && !flagged) throw Error(Get(map, table)!, $"{table} is given but {flag} is off; set it, or remove the table.");
        if (!present && flagged) throw Error(map, $"{flag} is on, so the base shape needs {table}.");
    }

    private static List<(ushort, uint)> ColorKeys(YamlNode node, string what)
    {
        List<(ushort, uint)> keys = [];
        foreach (YamlNode key in Sequence(node, what))
        {
            List<YamlNode> pair = [.. Sequence(key, $"a {what} key")];
            if (pair.Count != 2) throw Error(key, $"a {what} key is [frame, \"#RRGGBBAA\"].");
            keys.Add(((ushort)Integer(pair[0], "frame", 0, ushort.MaxValue), Color(pair[1])));
        }
        return keys;
    }

    private static void WriteColorKeys(byte[] body, int at, List<(ushort Time, uint Rgba)>? keys)
    {
        if (keys is null) return;
        for (int i = 0; i < keys.Count; i++)
        {
            BinaryPrimitives.WriteUInt16BigEndian(body.AsSpan(at - 8 + i * 6), keys[i].Time);
            BinaryPrimitives.WriteUInt32BigEndian(body.AsSpan(at - 8 + i * 6 + 2), keys[i].Rgba);
        }
    }

    private static void Put(byte[] body, Field field, YamlNode node)
    {
        List<YamlNode> values = field.Count == 1 ? [node] : [.. Sequence(node, field.Name)];
        if (values.Count != field.Count) throw Error(node, $"{field.Name} has {field.Count} values.");
        int step = field.Size / field.Count;
        for (int i = 0; i < values.Count; i++)
        {
            Span<byte> at = body.AsSpan(field.At - 8 + i * step, step);
            YamlNode v = values[i];
            switch (field.Kind)
            {
                case Kind.U8: case Kind.U8Hex: at[0] = (byte)Integer(v, field.Name, 0, byte.MaxValue); break;
                case Kind.S8: at[0] = (byte)(sbyte)Integer(v, field.Name, sbyte.MinValue, sbyte.MaxValue); break;
                case Kind.U16: case Kind.U16Hex: BinaryPrimitives.WriteUInt16BigEndian(at, (ushort)Integer(v, field.Name, 0, ushort.MaxValue)); break;
                case Kind.S16: BinaryPrimitives.WriteInt16BigEndian(at, (short)Integer(v, field.Name, short.MinValue, short.MaxValue)); break;
                case Kind.U32Hex: BinaryPrimitives.WriteUInt32BigEndian(at, (uint)Integer(v, field.Name, 0, uint.MaxValue)); break;
                case Kind.F32: BinaryPrimitives.WriteSingleBigEndian(at, Float(v, field.Name)); break;
                case Kind.Color: BinaryPrimitives.WriteUInt32BigEndian(at, Color(v)); break;
            }
        }
    }

    // ---- YAML helpers -----------------------------------------------------

    private static YamlNode? Get(YamlMappingNode map, string key) => map.Children.TryGetValue(new YamlScalarNode(key), out YamlNode? value) ? value : null;

    private static string Name(YamlNode key) => key is YamlScalarNode { Value: { } value } ? value : throw Error(key, "keys should be plain names.");

    private static IEnumerable<YamlNode> Sequence(YamlNode node, string what)
        => node as YamlSequenceNode ?? throw Error(node, $"{what} should be a list.");

    private static string Scalar(YamlNode node, string what)
        => node is YamlScalarNode { Value: { } value } ? value.Trim() : throw Error(node, $"{what} should be a single value.");

    private static long Integer(YamlNode node, string what, long min, long max, string? hint = null)
    {
        string text = Scalar(node, what);
        bool hex = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        if (!(hex
                ? long.TryParse(text.AsSpan(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out long value)
                : long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value)))
            throw Error(node, $"{what} '{text}' isn't a whole number{(hint is null ? "." : "; " + hint)}");
        return value >= min && value <= max ? value : throw Error(node, $"{what} is {text}, outside {min} to {max}.");
    }

    private static float Float(YamlNode node, string what)
    {
        string text = Scalar(node, what);
        return float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out float value)
            ? value
            : throw Error(node, $"{what} '{text}' isn't a number.");
    }

    private static uint Color(YamlNode node)
    {
        string text = Scalar(node, "color");
        string hex = text.StartsWith('#') ? text[1..] : text;
        if (hex.Length == 6) hex += "FF";
        return hex.Length == 8 && uint.TryParse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out uint rgba)
            ? rgba
            : throw Error(node, $"'{text}' isn't a color; write \"#RRGGBBAA\" or \"#RRGGBB\".");
    }

    private static FormatException Error(YamlNode node, string message) => new($"Line {node.Start.Line}: {message}");
}

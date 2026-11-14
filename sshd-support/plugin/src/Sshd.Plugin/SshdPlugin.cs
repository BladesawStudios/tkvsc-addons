using Tkvsc.Plugins;

[assembly: TkvscPlugin(typeof(Tkvsc.Sshd.SshdPlugin))]

namespace Tkvsc.Sshd;

/// <summary>
/// Skyward Sword HD: LZ11 compression, U8 archives, MSBF message flows and MSBP message projects. The host runs <see cref="Configure"/> for every command,
/// so it only registers.
/// </summary>
public sealed class SshdPlugin : IGamePlugin
{
    public void Configure(IPluginBuilder builder)
    {
        builder.UseCompression(new LzCompression());
        builder.AddArchiveFormat(new U8ArchiveFormat());
        builder.AddFormat("msbf", new MsbfFormat());
        builder.AddFormat("msbp", new MsbpFormat());
    }
}

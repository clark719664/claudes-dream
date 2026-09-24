using UnrealBuildTool;

public class SkyStack : ModuleRules
{
	public SkyStack(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"ApplicationCore", // clipboard for the share code
			"SlateCore",
			"AudioMixer",
			"AudioMixerCore"
		});
	}
}

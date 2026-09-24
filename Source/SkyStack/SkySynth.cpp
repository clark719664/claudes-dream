#include "SkySynth.h"

#include "Sound/SoundBase.h"

USkySynth::USkySynth(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetSampleRate(FSkySynthCore::SampleRate);
	NumChannels = 1;
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = false;
	bProcedural = true;
	DecompressionType = EDecompressionType::DTYPE_Procedural;
	SoundGroup = ESoundGroup::SOUNDGROUP_Default;
	SetPrecacheState(ESoundWavePrecacheState::Done);
	VirtualizationMode = EVirtualizationMode::PlayWhenSilent;
}

int32 USkySynth::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	OutAudio.Reset();
	OutAudio.AddZeroed(NumSamples * sizeof(int16));

	FSynthNote Incoming;
	while (Pending.Dequeue(Incoming))
	{
		Core.Trigger(Incoming);
	}

	Core.Render(reinterpret_cast<int16*>(OutAudio.GetData()), NumSamples,
		MusicLevel.load(std::memory_order_relaxed), bMuted.load(std::memory_order_relaxed));
	return NumSamples;
}

// Each preset emits its voices into the thread-safe queue.
#define SKYSTACK_EMIT [this](const FSynthNote& Note) { Play(Note); }

void USkySynth::PlayPlace(float Pitch) { SkySynthPresets::Place(SKYSTACK_EMIT, Pitch); }
void USkySynth::PlayPerfect(int32 Combo) { SkySynthPresets::Perfect(SKYSTACK_EMIT, Combo); }
void USkySynth::PlayChop() { SkySynthPresets::Chop(SKYSTACK_EMIT); }
void USkySynth::PlayClutch() { SkySynthPresets::Clutch(SKYSTACK_EMIT); }
void USkySynth::PlayMiss() { SkySynthPresets::Miss(SKYSTACK_EMIT); }
void USkySynth::PlayCollapse() { SkySynthPresets::Collapse(SKYSTACK_EMIT); }
void USkySynth::PlayZone() { SkySynthPresets::Zone(SKYSTACK_EMIT); }
void USkySynth::PlayRecord() { SkySynthPresets::Record(SKYSTACK_EMIT); }
void USkySynth::PlayGrow() { SkySynthPresets::Grow(SKYSTACK_EMIT); }
void USkySynth::PlayWarn() { SkySynthPresets::Warn(SKYSTACK_EMIT); }
void USkySynth::PlayClick() { SkySynthPresets::Click(SKYSTACK_EMIT); }
void USkySynth::PlayStart() { SkySynthPresets::Start(SKYSTACK_EMIT); }

#undef SKYSTACK_EMIT

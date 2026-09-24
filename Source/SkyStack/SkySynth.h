#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"
#include "SkySynthCore.h"
#include "Sound/SoundWaveProcedural.h"
#include <atomic>
#include "SkySynth.generated.h"

/**
 * SkyStack's audio: a procedural sound wave that runs FSkySynthCore (adaptive music plus every
 * sound effect) on the audio render thread. The game thread queues notes; no sound assets needed.
 */
UCLASS()
class SKYSTACK_API USkySynth : public USoundWaveProcedural
{
	GENERATED_BODY()

public:
	USkySynth(const FObjectInitializer& ObjectInitializer);

	/** Queue a note from the game thread. */
	void Play(const FSynthNote& Note) { Pending.Enqueue(Note); }

	/** -1 = ducked pads, 0 = pads, 1 = +kick/bass, 2 = +drums, 3 = +arpeggio. */
	void SetMusicLevel(int32 Level) { MusicLevel.store(Level, std::memory_order_relaxed); }
	void SetMuted(bool bInMuted) { bMuted.store(bInMuted, std::memory_order_relaxed); }

	// Sound effect presets (see SkySynthPresets).
	void PlayPlace(float Pitch = 1.f);
	void PlayPerfect(int32 Combo);
	void PlayChop();
	void PlayClutch();
	void PlayMiss();
	void PlayCollapse();
	void PlayZone();
	void PlayRecord();
	void PlayGrow();
	void PlayWarn();
	void PlayClick();
	void PlayStart();

	//~ USoundWaveProcedural: called on the audio render thread.
	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;

private:
	FSkySynthCore Core;
	TQueue<FSynthNote, EQueueMode::Mpsc> Pending;
	std::atomic<int32> MusicLevel{0};
	std::atomic<bool> bMuted{false};
};

#pragma once

#include "CoreMinimal.h"
#include "Containers/Queue.h"
#include "Sound/SoundWaveProcedural.h"
#include <atomic>
#include "SkySynth.generated.h"

enum class ESynthWave : uint8
{
	Sine,
	Triangle,
	Square,
	Saw,
	Noise
};

enum class ESynthFilter : uint8
{
	None,
	LowPass,
	HighPass
};

/** One synthesized sound event. Everything the game plays is built from these. */
struct FSynthNote
{
	ESynthWave Wave = ESynthWave::Sine;
	ESynthFilter Filter = ESynthFilter::None;
	float Freq = 440.f;
	/** Pitch glides exponentially from Freq toward FreqEnd when FreqEnd > 0. */
	float FreqEnd = 0.f;
	float Glide = 0.05f;
	float Attack = 0.003f;
	/** Time constant of the exponential decay after the attack. */
	float Decay = 0.25f;
	/** Hard stop (with a short release) after this many seconds when > 0. */
	float Length = 0.f;
	float Gain = 0.25f;
	/** One-pole filter coefficient, 0..1. */
	float Cutoff = 1.f;
	/** Vibrato depth as a fraction of the frequency. */
	float Vibrato = 0.f;
	/** Seconds to wait before starting; used for arpeggios. */
	float Delay = 0.f;
	bool bMusic = false;
};

/**
 * A tiny real-time synthesizer and step sequencer that renders all of SkyStack's audio:
 * adaptive music plus every sound effect. The game thread queues notes, and the audio
 * render thread mixes them in OnGeneratePCMAudio. No sound assets needed.
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

	static float MidiToHz(float Midi);

	// Sound effect presets.
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

protected:
	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;

private:
	struct FVoice
	{
		FSynthNote Note;
		float Phase = 0.f;
		float Time = 0.f;
		float Env = 1.f;
		float DecayMul = 1.f;
		float GlideOffset = 0.f;
		float GlideMul = 1.f;
		float Release = 1.f;
		float FilterState = 0.f;
		bool bActive = false;
	};

	void StartVoice(const FSynthNote& Note);
	void TickSequencer();
	float NextNoise();

	static constexpr int32 SampleRateHz = 48000;
	static constexpr int32 MaxVoices = 64;
	static constexpr int32 Bpm = 100;

	FVoice Voices[MaxVoices];
	TQueue<FSynthNote, EQueueMode::Mpsc> Pending;
	std::atomic<int32> MusicLevel{0};
	std::atomic<bool> bMuted{false};

	// Audio-thread-only state.
	int32 SamplesUntilStep = 0;
	int32 Step = 0;
	uint32 NoiseState = 0x9E3779B9u;
	float MusicGain = 0.f;
};

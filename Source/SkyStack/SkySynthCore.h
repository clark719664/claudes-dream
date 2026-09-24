#pragma once

// The synthesizer behind all of SkyStack's audio, free of engine types so it can be unit tested
// and rendered to WAV outside Unreal (see Tests/). USkySynth wraps it as a procedural sound wave.

#include <cstdint>

enum class ESynthWave : uint8_t
{
	Sine,
	Triangle,
	Square,
	Saw,
	Noise
};

enum class ESynthFilter : uint8_t
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
 * Voices + step sequencer. Not thread safe: call Trigger and Render from the same (audio) thread.
 * Renders mono 16-bit PCM at SampleRate.
 */
class FSkySynthCore
{
public:
	static constexpr int32_t SampleRate = 48000;
	static constexpr int32_t MaxVoices = 64;
	static constexpr int32_t Bpm = 100;

	static float MidiToHz(float Midi);

	void Trigger(const FSynthNote& Note);

	/** MusicLevel: -1 ducked pads, 0 pads + bass, 1 + kick, 2 + drums, 3 + arpeggio. */
	void Render(int16_t* Out, int32_t NumSamples, int32_t MusicLevel, bool bMuted);

	int32_t ActiveVoices() const;

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

	void TickSequencer(int32_t MusicLevel);
	float NextNoise();

	FVoice Voices[MaxVoices];
	int32_t SamplesUntilStep = 0;
	int32_t Step = 0;
	uint32_t NoiseState = 0x9E3779B9u;
	float MusicGain = 0.f;
};

/**
 * Sound effect recipes. Each calls Emit(const FSynthNote&) once per voice, so the same recipe
 * feeds the game's thread-safe queue or, in tests, the synth directly.
 */
namespace SkySynthPresets
{
	template <typename EmitFn>
	void Place(EmitFn&& Emit, float Pitch = 1.f)
	{
		FSynthNote Thock;
		Thock.Freq = 260.f * Pitch;
		Thock.FreqEnd = 90.f * Pitch;
		Thock.Glide = 0.025f;
		Thock.Attack = 0.001f;
		Thock.Decay = 0.07f;
		Thock.Gain = 0.5f;
		Emit(Thock);

		FSynthNote Click;
		Click.Wave = ESynthWave::Noise;
		Click.Filter = ESynthFilter::LowPass;
		Click.Cutoff = 0.35f;
		Click.Attack = 0.0005f;
		Click.Decay = 0.015f;
		Click.Gain = 0.3f;
		Emit(Click);
	}

	template <typename EmitFn>
	void Perfect(EmitFn&& Emit, int32_t Combo)
	{
		// Each perfect in a streak climbs the A minor pentatonic scale, the same key as the music.
		static constexpr int32_t Scale[] = { 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96 };
		constexpr int32_t Last = static_cast<int32_t>(sizeof(Scale) / sizeof(Scale[0])) - 1;
		const int32_t Step = Combo - 1 < 0 ? 0 : (Combo - 1 > Last ? Last : Combo - 1);
		const float Freq = FSkySynthCore::MidiToHz(static_cast<float>(Scale[Step]));

		Place(Emit, 1.1f);

		FSynthNote Bell;
		Bell.Freq = Freq;
		Bell.Attack = 0.002f;
		Bell.Decay = 0.5f;
		Bell.Gain = 0.3f;
		Emit(Bell);

		FSynthNote Overtone;
		Overtone.Freq = Freq * 2.f;
		Overtone.Attack = 0.002f;
		Overtone.Decay = 0.2f;
		Overtone.Gain = 0.1f;
		Emit(Overtone);

		FSynthNote Sparkle;
		Sparkle.Wave = ESynthWave::Triangle;
		Sparkle.Freq = Freq * 3.f;
		Sparkle.Attack = 0.001f;
		Sparkle.Decay = 0.08f;
		Sparkle.Gain = 0.06f;
		Emit(Sparkle);
	}

	template <typename EmitFn>
	void Chop(EmitFn&& Emit)
	{
		Place(Emit, 0.95f);

		FSynthNote Crunch;
		Crunch.Wave = ESynthWave::Noise;
		Crunch.Filter = ESynthFilter::LowPass;
		Crunch.Cutoff = 0.18f;
		Crunch.Attack = 0.001f;
		Crunch.Decay = 0.12f;
		Crunch.Gain = 0.4f;
		Emit(Crunch);

		FSynthNote Thud;
		Thud.Wave = ESynthWave::Square;
		Thud.Filter = ESynthFilter::LowPass;
		Thud.Cutoff = 0.1f;
		Thud.Freq = 120.f;
		Thud.FreqEnd = 60.f;
		Thud.Glide = 0.05f;
		Thud.Decay = 0.09f;
		Thud.Gain = 0.2f;
		Emit(Thud);
	}

	template <typename EmitFn>
	void Clutch(EmitFn&& Emit)
	{
		FSynthNote Whoosh;
		Whoosh.Wave = ESynthWave::Saw;
		Whoosh.Filter = ESynthFilter::LowPass;
		Whoosh.Cutoff = 0.2f;
		Whoosh.Freq = 200.f;
		Whoosh.FreqEnd = 900.f;
		Whoosh.Glide = 0.15f;
		Whoosh.Attack = 0.01f;
		Whoosh.Decay = 0.25f;
		Whoosh.Gain = 0.2f;
		Emit(Whoosh);

		FSynthNote Ping;
		Ping.Freq = 1320.f;
		Ping.Attack = 0.002f;
		Ping.Decay = 0.3f;
		Ping.Gain = 0.2f;
		Ping.Delay = 0.08f;
		Emit(Ping);
	}

	template <typename EmitFn>
	void Miss(EmitFn&& Emit)
	{
		FSynthNote Womp;
		Womp.Wave = ESynthWave::Saw;
		Womp.Filter = ESynthFilter::LowPass;
		Womp.Cutoff = 0.12f;
		Womp.Freq = 320.f;
		Womp.FreqEnd = 45.f;
		Womp.Glide = 0.3f;
		Womp.Attack = 0.005f;
		Womp.Decay = 0.7f;
		Womp.Gain = 0.4f;
		Emit(Womp);

		FSynthNote Boom;
		Boom.Freq = 90.f;
		Boom.FreqEnd = 30.f;
		Boom.Glide = 0.2f;
		Boom.Attack = 0.002f;
		Boom.Decay = 0.6f;
		Boom.Gain = 0.6f;
		Emit(Boom);
	}

	template <typename EmitFn>
	void Collapse(EmitFn&& Emit)
	{
		FSynthNote Rumble;
		Rumble.Wave = ESynthWave::Noise;
		Rumble.Filter = ESynthFilter::LowPass;
		Rumble.Cutoff = 0.05f;
		Rumble.Attack = 0.05f;
		Rumble.Decay = 1.2f;
		Rumble.Gain = 0.9f;
		Emit(Rumble);

		FSynthNote Sub;
		Sub.Freq = 55.f;
		Sub.FreqEnd = 32.f;
		Sub.Glide = 0.5f;
		Sub.Attack = 0.01f;
		Sub.Decay = 1.f;
		Sub.Gain = 0.5f;
		Emit(Sub);
	}

	template <typename EmitFn>
	void Zone(EmitFn&& Emit)
	{
		static constexpr int32_t Arp[] = { 69, 72, 76, 81, 84 };
		for (int32_t Index = 0; Index < 5; ++Index)
		{
			FSynthNote Note;
			Note.Wave = ESynthWave::Triangle;
			Note.Freq = FSkySynthCore::MidiToHz(static_cast<float>(Arp[Index]));
			Note.Attack = 0.003f;
			Note.Decay = Index == 4 ? 0.8f : 0.3f;
			Note.Gain = 0.22f;
			Note.Delay = static_cast<float>(Index) * 0.085f;
			Emit(Note);
		}
	}

	template <typename EmitFn>
	void Record(EmitFn&& Emit)
	{
		static constexpr int32_t Fanfare[] = { 72, 76, 79, 84, 88 };
		for (int32_t Index = 0; Index < 5; ++Index)
		{
			FSynthNote Note;
			Note.Wave = ESynthWave::Square;
			Note.Filter = ESynthFilter::LowPass;
			Note.Cutoff = 0.3f;
			Note.Freq = FSkySynthCore::MidiToHz(static_cast<float>(Fanfare[Index]));
			Note.Attack = 0.004f;
			Note.Decay = Index == 4 ? 0.9f : 0.25f;
			Note.Gain = 0.3f;
			Note.Vibrato = Index == 4 ? 0.006f : 0.f;
			Note.Delay = static_cast<float>(Index) * 0.1f;
			Emit(Note);
		}
	}

	template <typename EmitFn>
	void Grow(EmitFn&& Emit)
	{
		FSynthNote Rise;
		Rise.Freq = 440.f;
		Rise.FreqEnd = 880.f;
		Rise.Glide = 0.06f;
		Rise.Attack = 0.005f;
		Rise.Decay = 0.2f;
		Rise.Gain = 0.24f;
		Rise.Delay = 0.05f;
		Emit(Rise);
	}

	template <typename EmitFn>
	void Warn(EmitFn&& Emit)
	{
		for (int32_t Index = 0; Index < 2; ++Index)
		{
			FSynthNote Beep;
			Beep.Wave = ESynthWave::Square;
			Beep.Filter = ESynthFilter::LowPass;
			Beep.Cutoff = 0.45f;
			Beep.Freq = Index == 0 ? 880.f : 660.f;
			Beep.Attack = 0.002f;
			Beep.Decay = 0.07f;
			Beep.Gain = 0.3f;
			Beep.Delay = static_cast<float>(Index) * 0.12f;
			Emit(Beep);
		}
	}

	template <typename EmitFn>
	void Click(EmitFn&& Emit)
	{
		FSynthNote Tick;
		Tick.Freq = 1200.f;
		Tick.Attack = 0.001f;
		Tick.Decay = 0.025f;
		Tick.Gain = 0.15f;
		Emit(Tick);
	}

	template <typename EmitFn>
	void Start(EmitFn&& Emit)
	{
		FSynthNote Rise;
		Rise.Wave = ESynthWave::Triangle;
		Rise.Freq = 330.f;
		Rise.FreqEnd = 660.f;
		Rise.Glide = 0.06f;
		Rise.Attack = 0.003f;
		Rise.Decay = 0.25f;
		Rise.Gain = 0.25f;
		Emit(Rise);

		FSynthNote Air;
		Air.Wave = ESynthWave::Noise;
		Air.Filter = ESynthFilter::HighPass;
		Air.Cutoff = 0.3f;
		Air.Attack = 0.02f;
		Air.Decay = 0.1f;
		Air.Gain = 0.06f;
		Emit(Air);
	}
}

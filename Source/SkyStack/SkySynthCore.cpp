#include "SkySynthCore.h"

#include <cmath>
#include <initializer_list>

namespace
{
	constexpr float TwoPi = 6.28318530717958647f;

	float ClampFloat(float Value, float Low, float High)
	{
		return Value < Low ? Low : (Value > High ? High : Value);
	}
}

float FSkySynthCore::MidiToHz(float Midi)
{
	return 440.f * std::pow(2.f, (Midi - 69.f) / 12.f);
}

float FSkySynthCore::NextNoise()
{
	// xorshift32
	NoiseState ^= NoiseState << 13;
	NoiseState ^= NoiseState >> 17;
	NoiseState ^= NoiseState << 5;
	return static_cast<float>(NoiseState) / 2147483648.f - 1.f;
}

int32_t FSkySynthCore::ActiveVoices() const
{
	int32_t Count = 0;
	for (const FVoice& Voice : Voices)
	{
		Count += Voice.bActive ? 1 : 0;
	}
	return Count;
}

void FSkySynthCore::Trigger(const FSynthNote& Note)
{
	// Take a free voice, or steal the oldest one.
	FVoice* Target = &Voices[0];
	float OldestTime = -1.f;
	for (FVoice& Voice : Voices)
	{
		if (!Voice.bActive)
		{
			Target = &Voice;
			break;
		}
		if (Voice.Time > OldestTime)
		{
			OldestTime = Voice.Time;
			Target = &Voice;
		}
	}

	const float Dt = 1.f / static_cast<float>(SampleRate);
	FVoice& V = *Target;
	V.Note = Note;
	V.Phase = 0.f;
	V.Time = -(Note.Delay > 0.f ? Note.Delay : 0.f);
	V.Env = 1.f;
	V.DecayMul = std::exp(-Dt / (Note.Decay > 0.001f ? Note.Decay : 0.001f));
	V.GlideOffset = Note.FreqEnd > 0.f ? Note.Freq - Note.FreqEnd : 0.f;
	V.GlideMul = std::exp(-Dt / (Note.Glide > 0.001f ? Note.Glide : 0.001f));
	V.Release = 1.f;
	V.FilterState = 0.f;
	V.bActive = true;
}

void FSkySynthCore::Render(int16_t* Out, int32_t NumSamples, int32_t MusicLevel, bool bMuted)
{
	const float MusicTarget = MusicLevel < 0 ? 0.6f : 1.f;
	const float Master = bMuted ? 0.f : 0.8f;
	const float Dt = 1.f / static_cast<float>(SampleRate);
	const int32_t StepSamples = SampleRate * 60 / Bpm / 4;

	for (int32_t Index = 0; Index < NumSamples; ++Index)
	{
		if (--SamplesUntilStep <= 0)
		{
			TickSequencer(MusicLevel);
			SamplesUntilStep = StepSamples;
		}
		MusicGain += (MusicTarget - MusicGain) * 0.00005f;

		float Sfx = 0.f;
		float Music = 0.f;
		for (FVoice& V : Voices)
		{
			if (!V.bActive)
			{
				continue;
			}
			if (V.Time < 0.f)
			{
				V.Time += Dt;
				continue;
			}

			const FSynthNote& N = V.Note;
			float Freq = N.FreqEnd > 0.f ? N.FreqEnd + V.GlideOffset : N.Freq;
			V.GlideOffset *= V.GlideMul;
			if (N.Vibrato > 0.f)
			{
				Freq *= 1.f + N.Vibrato * std::sin(V.Time * TwoPi * 5.5f);
			}
			V.Phase += Freq * Dt;
			V.Phase -= std::floor(V.Phase);

			float Sample = 0.f;
			switch (N.Wave)
			{
			case ESynthWave::Sine:     Sample = std::sin(V.Phase * TwoPi); break;
			case ESynthWave::Triangle: Sample = 4.f * std::fabs(V.Phase - 0.5f) - 1.f; break;
			case ESynthWave::Square:   Sample = V.Phase < 0.5f ? 0.6f : -0.6f; break;
			case ESynthWave::Saw:      Sample = 2.f * V.Phase - 1.f; break;
			case ESynthWave::Noise:    Sample = NextNoise(); break;
			}

			if (N.Filter == ESynthFilter::LowPass)
			{
				V.FilterState += N.Cutoff * (Sample - V.FilterState);
				Sample = V.FilterState;
			}
			else if (N.Filter == ESynthFilter::HighPass)
			{
				V.FilterState += N.Cutoff * (Sample - V.FilterState);
				Sample -= V.FilterState;
			}

			float Amp;
			if (N.Attack > 0.f && V.Time < N.Attack)
			{
				Amp = V.Time / N.Attack;
			}
			else
			{
				Amp = V.Env;
				V.Env *= V.DecayMul;
			}
			if (N.Length > 0.f && V.Time > N.Length)
			{
				V.Release -= Dt / 0.04f;
				Amp *= V.Release > 0.f ? V.Release : 0.f;
			}

			(N.bMusic ? Music : Sfx) += Sample * Amp * N.Gain;
			V.Time += Dt;

			if (V.Release <= 0.f || (V.Time >= N.Attack && V.Env < 0.0005f))
			{
				V.bActive = false;
			}
		}

		float Mix = (Sfx + Music * MusicGain * 0.55f) * Master;
		// Soft clip (rational tanh approximation) so stacked hits never crackle.
		Mix = ClampFloat(Mix, -3.f, 3.f);
		Mix = Mix * (27.f + Mix * Mix) / (27.f + 9.f * Mix * Mix);
		Out[Index] = static_cast<int16_t>(ClampFloat(Mix * 32000.f, -32767.f, 32767.f));
	}
}

void FSkySynthCore::TickSequencer(int32_t Level)
{
	// i - VI - III - VII in A minor: Am, F, C, G.
	static constexpr int32_t Roots[4] = { 45, 41, 48, 43 };
	static constexpr int32_t Chords[4][3] = { { 57, 60, 64 }, { 57, 60, 65 }, { 55, 60, 64 }, { 55, 59, 62 } };

	const int32_t Bar = (Step / 16) % 4;
	const int32_t Sixteenth = Step % 16;
	++Step;

	auto Music = [this](FSynthNote Note)
	{
		Note.bMusic = true;
		Trigger(Note);
	};

	// Pads: always on, two detuned saws per chord tone.
	if (Sixteenth == 0)
	{
		for (int32_t Tone = 0; Tone < 3; ++Tone)
		{
			for (const float Detune : { 0.997f, 1.003f })
			{
				FSynthNote Pad;
				Pad.Wave = ESynthWave::Saw;
				Pad.Filter = ESynthFilter::LowPass;
				Pad.Cutoff = 0.07f;
				Pad.Freq = MidiToHz(static_cast<float>(Chords[Bar][Tone])) * Detune;
				Pad.Attack = 0.45f;
				Pad.Decay = 1.8f;
				Pad.Length = 2.35f;
				Pad.Gain = 0.06f;
				Pad.Vibrato = 0.002f;
				Music(Pad);
			}
		}
	}

	// Title only: a soft music-box motif over the pads.
	if (Level == 0 && (Sixteenth == 0 || Sixteenth == 3 || Sixteenth == 6 || Sixteenth == 10 || Sixteenth == 13))
	{
		static constexpr int32_t Motif[5] = { 2, 1, 0, 1, 2 };
		const int32_t Note = Sixteenth == 0 ? 0 : (Sixteenth == 3 ? 1 : (Sixteenth == 6 ? 2 : (Sixteenth == 10 ? 3 : 4)));
		FSynthNote Pluck;
		Pluck.Wave = ESynthWave::Triangle;
		Pluck.Freq = MidiToHz(static_cast<float>(Chords[Bar][Motif[Note]] + 24));
		Pluck.Attack = 0.002f;
		Pluck.Decay = 0.35f;
		Pluck.Gain = 0.07f;
		Pluck.Vibrato = 0.003f;
		Music(Pluck);
	}

	// Bass: slow and long on the title and game over, tight once the beat comes in.
	if (Sixteenth == 0 || Sixteenth == 10)
	{
		FSynthNote Bass;
		Bass.Wave = ESynthWave::Triangle;
		Bass.Filter = ESynthFilter::LowPass;
		Bass.Cutoff = 0.25f;
		Bass.Freq = MidiToHz(static_cast<float>(Roots[Bar]));
		Bass.Attack = 0.005f;
		Bass.Decay = Level >= 1 ? 0.22f : 0.5f;
		Bass.Gain = 0.3f;
		Music(Bass);
	}

	if (Level >= 1)
	{
		if (Sixteenth == 0 || Sixteenth == 8 || (Level >= 2 && Sixteenth == 11))
		{
			FSynthNote Kick;
			Kick.Freq = 150.f;
			Kick.FreqEnd = 45.f;
			Kick.Glide = 0.03f;
			Kick.Attack = 0.001f;
			Kick.Decay = 0.13f;
			Kick.Gain = 0.6f;
			Music(Kick);
		}
		if (Sixteenth == 6)
		{
			FSynthNote Bass;
			Bass.Wave = ESynthWave::Triangle;
			Bass.Filter = ESynthFilter::LowPass;
			Bass.Cutoff = 0.25f;
			Bass.Freq = MidiToHz(static_cast<float>(Roots[Bar] + 12));
			Bass.Decay = 0.15f;
			Bass.Gain = 0.22f;
			Music(Bass);
		}
	}

	if (Level >= 2)
	{
		if (Sixteenth % 4 == 2)
		{
			FSynthNote Hat;
			Hat.Wave = ESynthWave::Noise;
			Hat.Filter = ESynthFilter::HighPass;
			Hat.Cutoff = 0.5f;
			Hat.Attack = 0.001f;
			Hat.Decay = 0.025f;
			Hat.Gain = 0.12f;
			Music(Hat);
		}
		if (Sixteenth == 4 || Sixteenth == 12)
		{
			FSynthNote Snare;
			Snare.Wave = ESynthWave::Noise;
			Snare.Filter = ESynthFilter::LowPass;
			Snare.Cutoff = 0.45f;
			Snare.Attack = 0.001f;
			Snare.Decay = 0.08f;
			Snare.Gain = 0.25f;
			Music(Snare);

			FSynthNote Body;
			Body.Freq = 210.f;
			Body.FreqEnd = 160.f;
			Body.Glide = 0.03f;
			Body.Attack = 0.001f;
			Body.Decay = 0.05f;
			Body.Gain = 0.18f;
			Music(Body);
		}
	}

	if (Level >= 3 && Sixteenth % 2 == 0)
	{
		static constexpr int32_t Pattern[8] = { 0, 1, 2, 1, 0, 2, 1, 2 };
		FSynthNote Arp;
		Arp.Wave = ESynthWave::Triangle;
		Arp.Freq = MidiToHz(static_cast<float>(Chords[Bar][Pattern[Sixteenth / 2]] + 12));
		Arp.Attack = 0.002f;
		Arp.Decay = 0.12f;
		Arp.Gain = 0.1f;
		Music(Arp);
	}
}

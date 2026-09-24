#include "SkySynth.h"

#include "Sound/SoundBase.h"

USkySynth::USkySynth(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetSampleRate(SampleRateHz);
	NumChannels = 1;
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = false;
	VirtualizationMode = EVirtualizationMode::PlayWhenSilent;
}

float USkySynth::MidiToHz(float Midi)
{
	return 440.f * FMath::Pow(2.f, (Midi - 69.f) / 12.f);
}

float USkySynth::NextNoise()
{
	// xorshift32
	NoiseState ^= NoiseState << 13;
	NoiseState ^= NoiseState >> 17;
	NoiseState ^= NoiseState << 5;
	return static_cast<float>(NoiseState) / 2147483648.f - 1.f;
}

void USkySynth::StartVoice(const FSynthNote& Note)
{
	// Take a free voice, or steal the oldest one.
	FVoice* Target = nullptr;
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

	const float Dt = 1.f / SampleRateHz;
	FVoice& V = *Target;
	V.Note = Note;
	V.Phase = 0.f;
	V.Time = -FMath::Max(Note.Delay, 0.f);
	V.Env = 1.f;
	V.DecayMul = FMath::Exp(-Dt / FMath::Max(Note.Decay, 0.001f));
	V.GlideOffset = Note.FreqEnd > 0.f ? Note.Freq - Note.FreqEnd : 0.f;
	V.GlideMul = FMath::Exp(-Dt / FMath::Max(Note.Glide, 0.001f));
	V.Release = 1.f;
	V.FilterState = 0.f;
	V.bActive = true;
}

int32 USkySynth::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	OutAudio.Reset();
	OutAudio.AddZeroed(NumSamples * sizeof(int16));
	int16* Out = reinterpret_cast<int16*>(OutAudio.GetData());

	FSynthNote Incoming;
	while (Pending.Dequeue(Incoming))
	{
		StartVoice(Incoming);
	}

	const int32 Level = MusicLevel.load(std::memory_order_relaxed);
	const float MusicTarget = Level < 0 ? 0.35f : 1.f;
	const float Master = bMuted.load(std::memory_order_relaxed) ? 0.f : 0.8f;
	const float Dt = 1.f / SampleRateHz;
	const int32 StepSamples = SampleRateHz * 60 / Bpm / 4;

	for (int32 Index = 0; Index < NumSamples; ++Index)
	{
		if (--SamplesUntilStep <= 0)
		{
			TickSequencer();
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
				Freq *= 1.f + N.Vibrato * FMath::Sin(V.Time * UE_TWO_PI * 5.5f);
			}
			V.Phase += Freq * Dt;
			V.Phase -= FMath::FloorToFloat(V.Phase);

			float Sample = 0.f;
			switch (N.Wave)
			{
			case ESynthWave::Sine:     Sample = FMath::Sin(V.Phase * UE_TWO_PI); break;
			case ESynthWave::Triangle: Sample = 4.f * FMath::Abs(V.Phase - 0.5f) - 1.f; break;
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
				Amp *= FMath::Max(V.Release, 0.f);
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
		Mix = FMath::Clamp(Mix, -3.f, 3.f);
		Mix = Mix * (27.f + Mix * Mix) / (27.f + 9.f * Mix * Mix);
		Out[Index] = static_cast<int16>(FMath::Clamp(Mix * 32000.f, -32767.f, 32767.f));
	}

	return NumSamples;
}

void USkySynth::TickSequencer()
{
	// i - VI - III - VII in A minor: Am, F, C, G.
	static const int32 Roots[4] = { 45, 41, 48, 43 };
	static const int32 Chords[4][3] = { { 57, 60, 64 }, { 57, 60, 65 }, { 55, 60, 64 }, { 55, 59, 62 } };

	const int32 Level = MusicLevel.load(std::memory_order_relaxed);
	const int32 Bar = (Step / 16) % 4;
	const int32 Sixteenth = Step % 16;
	++Step;

	auto Music = [this](FSynthNote Note)
	{
		Note.bMusic = true;
		StartVoice(Note);
	};

	// Pads: always on, two detuned saws per chord tone.
	if (Sixteenth == 0)
	{
		for (int32 Tone = 0; Tone < 3; ++Tone)
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

	if (Level >= 0 && (Sixteenth == 0 || Sixteenth == 10))
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
		static const int32 Pattern[8] = { 0, 1, 2, 1, 0, 2, 1, 2 };
		FSynthNote Arp;
		Arp.Wave = ESynthWave::Triangle;
		Arp.Freq = MidiToHz(static_cast<float>(Chords[Bar][Pattern[Sixteenth / 2]] + 12));
		Arp.Attack = 0.002f;
		Arp.Decay = 0.12f;
		Arp.Gain = 0.1f;
		Music(Arp);
	}
}

// ---------------------------------------------------------------------------------------------
// Sound effect presets
// ---------------------------------------------------------------------------------------------

void USkySynth::PlayPlace(float Pitch)
{
	FSynthNote Thock;
	Thock.Freq = 260.f * Pitch;
	Thock.FreqEnd = 90.f * Pitch;
	Thock.Glide = 0.025f;
	Thock.Attack = 0.001f;
	Thock.Decay = 0.07f;
	Thock.Gain = 0.5f;
	Play(Thock);

	FSynthNote Click;
	Click.Wave = ESynthWave::Noise;
	Click.Filter = ESynthFilter::LowPass;
	Click.Cutoff = 0.35f;
	Click.Attack = 0.0005f;
	Click.Decay = 0.015f;
	Click.Gain = 0.3f;
	Play(Click);
}

void USkySynth::PlayPerfect(int32 Combo)
{
	// Each perfect in a streak climbs the A minor pentatonic scale, the same key as the music.
	static const int32 Scale[] = { 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96 };
	const int32 Last = static_cast<int32>(UE_ARRAY_COUNT(Scale)) - 1;
	const float Freq = MidiToHz(static_cast<float>(Scale[FMath::Clamp(Combo - 1, 0, Last)]));

	PlayPlace(1.1f);

	FSynthNote Bell;
	Bell.Freq = Freq;
	Bell.Attack = 0.002f;
	Bell.Decay = 0.5f;
	Bell.Gain = 0.3f;
	Play(Bell);

	FSynthNote Overtone;
	Overtone.Freq = Freq * 2.f;
	Overtone.Attack = 0.002f;
	Overtone.Decay = 0.2f;
	Overtone.Gain = 0.1f;
	Play(Overtone);

	FSynthNote Sparkle;
	Sparkle.Wave = ESynthWave::Triangle;
	Sparkle.Freq = Freq * 3.f;
	Sparkle.Attack = 0.001f;
	Sparkle.Decay = 0.08f;
	Sparkle.Gain = 0.06f;
	Play(Sparkle);
}

void USkySynth::PlayChop()
{
	PlayPlace(0.95f);

	FSynthNote Crunch;
	Crunch.Wave = ESynthWave::Noise;
	Crunch.Filter = ESynthFilter::LowPass;
	Crunch.Cutoff = 0.18f;
	Crunch.Attack = 0.001f;
	Crunch.Decay = 0.12f;
	Crunch.Gain = 0.4f;
	Play(Crunch);

	FSynthNote Thud;
	Thud.Wave = ESynthWave::Square;
	Thud.Filter = ESynthFilter::LowPass;
	Thud.Cutoff = 0.1f;
	Thud.Freq = 120.f;
	Thud.FreqEnd = 60.f;
	Thud.Glide = 0.05f;
	Thud.Decay = 0.09f;
	Thud.Gain = 0.2f;
	Play(Thud);
}

void USkySynth::PlayClutch()
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
	Whoosh.Gain = 0.14f;
	Play(Whoosh);

	FSynthNote Ping;
	Ping.Freq = 1320.f;
	Ping.Attack = 0.002f;
	Ping.Decay = 0.3f;
	Ping.Gain = 0.12f;
	Ping.Delay = 0.08f;
	Play(Ping);
}

void USkySynth::PlayMiss()
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
	Play(Womp);

	FSynthNote Boom;
	Boom.Freq = 90.f;
	Boom.FreqEnd = 30.f;
	Boom.Glide = 0.2f;
	Boom.Attack = 0.002f;
	Boom.Decay = 0.6f;
	Boom.Gain = 0.6f;
	Play(Boom);
}

void USkySynth::PlayCollapse()
{
	FSynthNote Rumble;
	Rumble.Wave = ESynthWave::Noise;
	Rumble.Filter = ESynthFilter::LowPass;
	Rumble.Cutoff = 0.05f;
	Rumble.Attack = 0.05f;
	Rumble.Decay = 1.2f;
	Rumble.Gain = 0.9f;
	Play(Rumble);

	FSynthNote Sub;
	Sub.Freq = 55.f;
	Sub.FreqEnd = 32.f;
	Sub.Glide = 0.5f;
	Sub.Attack = 0.01f;
	Sub.Decay = 1.f;
	Sub.Gain = 0.5f;
	Play(Sub);
}

void USkySynth::PlayZone()
{
	static const int32 Arp[] = { 69, 72, 76, 81, 84 };
	for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Arp)); ++Index)
	{
		FSynthNote Note;
		Note.Wave = ESynthWave::Triangle;
		Note.Freq = MidiToHz(static_cast<float>(Arp[Index]));
		Note.Attack = 0.003f;
		Note.Decay = Index == 4 ? 0.8f : 0.3f;
		Note.Gain = 0.22f;
		Note.Delay = Index * 0.085f;
		Play(Note);
	}
}

void USkySynth::PlayRecord()
{
	static const int32 Fanfare[] = { 72, 76, 79, 84, 88 };
	for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Fanfare)); ++Index)
	{
		FSynthNote Note;
		Note.Wave = ESynthWave::Square;
		Note.Filter = ESynthFilter::LowPass;
		Note.Cutoff = 0.3f;
		Note.Freq = MidiToHz(static_cast<float>(Fanfare[Index]));
		Note.Attack = 0.004f;
		Note.Decay = Index == 4 ? 0.9f : 0.25f;
		Note.Gain = 0.16f;
		Note.Vibrato = Index == 4 ? 0.006f : 0.f;
		Note.Delay = Index * 0.1f;
		Play(Note);
	}
}

void USkySynth::PlayGrow()
{
	FSynthNote Rise;
	Rise.Freq = 440.f;
	Rise.FreqEnd = 880.f;
	Rise.Glide = 0.06f;
	Rise.Attack = 0.005f;
	Rise.Decay = 0.2f;
	Rise.Gain = 0.15f;
	Rise.Delay = 0.05f;
	Play(Rise);
}

void USkySynth::PlayWarn()
{
	for (int32 Index = 0; Index < 2; ++Index)
	{
		FSynthNote Beep;
		Beep.Wave = ESynthWave::Square;
		Beep.Filter = ESynthFilter::LowPass;
		Beep.Cutoff = 0.3f;
		Beep.Freq = Index == 0 ? 880.f : 660.f;
		Beep.Attack = 0.002f;
		Beep.Decay = 0.07f;
		Beep.Gain = 0.12f;
		Beep.Delay = Index * 0.12f;
		Play(Beep);
	}
}

void USkySynth::PlayClick()
{
	FSynthNote Tick;
	Tick.Freq = 1200.f;
	Tick.Attack = 0.001f;
	Tick.Decay = 0.025f;
	Tick.Gain = 0.15f;
	Play(Tick);
}

void USkySynth::PlayStart()
{
	FSynthNote Rise;
	Rise.Wave = ESynthWave::Triangle;
	Rise.Freq = 330.f;
	Rise.FreqEnd = 660.f;
	Rise.Glide = 0.06f;
	Rise.Attack = 0.003f;
	Rise.Decay = 0.25f;
	Rise.Gain = 0.25f;
	Play(Rise);

	FSynthNote Air;
	Air.Wave = ESynthWave::Noise;
	Air.Filter = ESynthFilter::HighPass;
	Air.Cutoff = 0.3f;
	Air.Attack = 0.02f;
	Air.Decay = 0.1f;
	Air.Gain = 0.06f;
	Play(Air);
}

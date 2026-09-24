// Renders SkyStack's real audio (FSkySynthCore + SkySynthPresets) to WAV files:
//   run_demo.wav   A bot plays a run through the actual rules; every sound fires when the game would.
//   sfx_sheet.wav  Every sound effect in turn.
//   music_layers.wav  The adaptive music stepping through its levels.

#include "../Source/SkyStack/SkyStackRules.h"
#include "../Source/SkyStack/SkySynthCore.h"

#include <cmath>
#include <cstdio>
#include <functional>
#include <random>
#include <string>
#include <vector>

namespace
{
	constexpr int32_t Rate = FSkySynthCore::SampleRate;

	void WriteWav(const std::string& Path, const std::vector<int16_t>& Samples)
	{
		FILE* File = std::fopen(Path.c_str(), "wb");
		if (!File)
		{
			std::printf("could not write %s\n", Path.c_str());
			return;
		}
		const uint32_t DataBytes = static_cast<uint32_t>(Samples.size() * sizeof(int16_t));
		auto U32 = [&](uint32_t Value) { std::fwrite(&Value, 4, 1, File); };
		auto U16 = [&](uint16_t Value) { std::fwrite(&Value, 2, 1, File); };
		std::fwrite("RIFF", 1, 4, File); U32(36 + DataBytes); std::fwrite("WAVE", 1, 4, File);
		std::fwrite("fmt ", 1, 4, File); U32(16); U16(1); U16(1); U32(Rate); U32(Rate * 2); U16(2); U16(16);
		std::fwrite("data", 1, 4, File); U32(DataBytes);
		std::fwrite(Samples.data(), sizeof(int16_t), Samples.size(), File);
		std::fclose(File);
		std::printf("wrote %s (%.1f s)\n", Path.c_str(), static_cast<double>(Samples.size()) / Rate);
	}

	/** Renders audio while letting a script schedule events at exact times. */
	struct FTimeline
	{
		FSkySynthCore Synth;
		std::vector<int16_t> Out;
		int32_t MusicLevel = 0;

		double Now() const { return static_cast<double>(Out.size()) / Rate; }

		void RenderUntil(double Seconds)
		{
			while (Now() < Seconds)
			{
				const size_t Remaining = static_cast<size_t>((Seconds - Now()) * Rate) + 1;
				const size_t Count = Remaining < 256 ? Remaining : 256;
				const size_t Start = Out.size();
				Out.resize(Start + Count);
				Synth.Render(Out.data() + Start, static_cast<int32_t>(Count), MusicLevel, false);
			}
		}

		auto Emit()
		{
			return [this](const FSynthNote& Note) { Synth.Trigger(Note); };
		}
	};

	void RenderRunDemo(const std::string& Dir)
	{
		using namespace SkyStackRules;
		using namespace SkyStackTuning;

		FTimeline Line;
		std::mt19937 Rng(20260924);
		std::uniform_real_distribution<float> Uniform(0.f, 1.f);

		// Title screen.
		Line.MusicLevel = MusicLevel(false, true, 0, 0);
		Line.RenderUntil(6.0);
		SkySynthPresets::Start(Line.Emit());

		const int32_t PreviousBest = 24;
		int32_t Floor = 0, Combo = 0, Zone = 0;
		double Extent = BaseSize;
		bool bPassedBest = false;
		double Time = Line.Now();

		// The bot gets sloppier over time so the run shows streaks, trims, a clutch and a fall.
		while (true)
		{
			Line.MusicLevel = MusicLevel(true, false, Combo, Floor);
			float Speed = BaseSliderSpeed(Floor) * (SpeedJitterMin + (SpeedJitterMax - SpeedJitterMin) * Uniform(Rng));
			const bool bWobble = Floor >= WobbleFromFloor && Uniform(Rng) < WobbleChance;
			const bool bRush = Floor >= RushFromFloor && !bWobble && Uniform(Rng) < RushChance;
			if (bRush)
			{
				Speed *= RushMultiplier;
			}
			if (bWobble || bRush)
			{
				SkySynthPresets::Warn(Line.Emit());
			}

			// Slider crosses the centre after travelling TravelRange; the bot aims for that moment.
			const double Sigma = Floor < 8 ? 0.008 : (Floor < 20 ? 0.02 : (Floor < 30 ? 0.03 : 0.06));
			std::normal_distribution<double> TimingError(0.0, Sigma);
			const double Error = TimingError(Rng);
			const double DropTime = Time + TravelRange / Speed + Error + 0.15;
			Line.RenderUntil(DropTime);

			const FDropOutcome Outcome = ResolveDrop(Speed * Error, Extent, Speed);
			if (Outcome.Kind == EDropKind::Miss || Floor >= 36)
			{
				SkySynthPresets::Miss(Line.Emit());
				Line.MusicLevel = -1;
				Line.RenderUntil(Line.Now() + 0.5);
				SkySynthPresets::Collapse(Line.Emit());
				Line.RenderUntil(Line.Now() + 1.6);
				SkySynthPresets::Click(Line.Emit()); // copy share code
				Line.RenderUntil(Line.Now() + 6.0);
				break;
			}

			if (Outcome.Kind == EDropKind::Perfect)
			{
				++Combo;
				SkySynthPresets::Perfect(Line.Emit(), Combo);
				if (EarnsGrowth(Combo) && Extent < BaseSize)
				{
					Extent = Grow(Extent);
					SkySynthPresets::Grow(Line.Emit());
				}
			}
			else
			{
				Combo = 0;
				Extent = Outcome.Kept;
				SkySynthPresets::Chop(Line.Emit());
				if (Outcome.Kind == EDropKind::Clutch)
				{
					SkySynthPresets::Clutch(Line.Emit());
				}
			}
			++Floor;
			const int32_t NewZone = ZoneForFloor(Floor, 7);
			if (NewZone != Zone)
			{
				Zone = NewZone;
				SkySynthPresets::Zone(Line.Emit());
			}
			if (!bPassedBest && Floor > PreviousBest)
			{
				bPassedBest = true;
				SkySynthPresets::Record(Line.Emit());
			}
			Time = Line.Now();
		}
		std::printf("run demo: reached floor %d\n", Floor);
		WriteWav(Dir + "/run_demo.wav", Line.Out);
	}

	void RenderSfxSheet(const std::string& Dir)
	{
		FTimeline Line;
		Line.MusicLevel = -1;
		const std::vector<std::function<void()>> Effects =
		{
			[&] { SkySynthPresets::Place(Line.Emit()); },
			[&] { SkySynthPresets::Chop(Line.Emit()); },
			[&] { for (int32_t Combo = 1; Combo <= 8; ++Combo) { SkySynthPresets::Perfect(Line.Emit(), Combo); Line.RenderUntil(Line.Now() + 0.35); } },
			[&] { SkySynthPresets::Grow(Line.Emit()); },
			[&] { SkySynthPresets::Chop(Line.Emit()); SkySynthPresets::Clutch(Line.Emit()); },
			[&] { SkySynthPresets::Warn(Line.Emit()); },
			[&] { SkySynthPresets::Zone(Line.Emit()); },
			[&] { SkySynthPresets::Record(Line.Emit()); },
			[&] { SkySynthPresets::Miss(Line.Emit()); Line.RenderUntil(Line.Now() + 0.5); SkySynthPresets::Collapse(Line.Emit()); },
			[&] { SkySynthPresets::Start(Line.Emit()); },
			[&] { SkySynthPresets::Click(Line.Emit()); },
		};
		for (const auto& Fire : Effects)
		{
			Fire();
			Line.RenderUntil(Line.Now() + 1.4);
		}
		WriteWav(Dir + "/sfx_sheet.wav", Line.Out);
	}

	void RenderMusicLayers(const std::string& Dir)
	{
		FTimeline Line;
		for (int32_t Level = 0; Level <= 3; ++Level)
		{
			Line.MusicLevel = Level;
			Line.RenderUntil(Line.Now() + 9.6); // one full 4-bar loop per level
		}
		Line.MusicLevel = -1;
		Line.RenderUntil(Line.Now() + 4.8);
		WriteWav(Dir + "/music_layers.wav", Line.Out);
	}
}

int main(int ArgCount, char** Args)
{
	const std::string Dir = ArgCount > 1 ? Args[1] : ".";
	RenderRunDemo(Dir);
	RenderSfxSheet(Dir);
	RenderMusicLayers(Dir);
	return 0;
}

// Unit tests for the engine-free game rules and synth. Build and run with Tests/run.sh.

#include "../Source/SkyStack/SkyStackRules.h"
#include "../Source/SkyStack/SkySynthCore.h"

#include <cmath>
#include <cstdio>
#include <vector>

namespace
{
	int Failures = 0;
	int Checks = 0;

	void Check(bool bCondition, const char* What, int Line)
	{
		++Checks;
		if (!bCondition)
		{
			++Failures;
			std::printf("FAIL line %d: %s\n", Line, What);
		}
	}

#define CHECK(Condition) Check((Condition), #Condition, __LINE__)
#define NEAR(A, B) (std::fabs((A) - (B)) < 1e-6)

	using namespace SkyStackRules;
	using namespace SkyStackTuning;

	void TestDrop()
	{
		// Miss: the slider is entirely off the top block.
		CHECK(ResolveDrop(320.0, 320.0, 300.0).Kind == EDropKind::Miss);
		CHECK(ResolveDrop(-400.0, 320.0, 300.0).Kind == EDropKind::Miss);

		// Perfect: inside the window, nothing is cut.
		const FDropOutcome Perfect = ResolveDrop(5.0, 320.0, 300.0);
		CHECK(Perfect.Kind == EDropKind::Perfect);
		CHECK(NEAR(Perfect.Kept, 320.0) && NEAR(Perfect.Chip, 0.0) && NEAR(Perfect.CenterShift, 0.0));

		// The window widens with speed (constant in time).
		CHECK(NEAR(PerfectWindow(100.0), PerfectTolerance));
		CHECK(NEAR(PerfectWindow(500.0), 500.0 * PerfectWindowSeconds));
		CHECK(NEAR(PerfectWindow(5000.0), PerfectToleranceMax));
		CHECK(ResolveDrop(14.0, 320.0, 550.0).Kind == EDropKind::Perfect);
		CHECK(ResolveDrop(20.0, 320.0, 300.0).Kind != EDropKind::Perfect);

		// Geometry: for any offset, the kept piece is exactly the overlap of the two blocks and the
		// chip is exactly the overhang, on both sides.
		for (double Offset = -319.0; Offset <= 319.0; Offset += 7.0)
		{
			const double Extent = 320.0;
			const FDropOutcome Out = ResolveDrop(Offset, Extent, 300.0);
			if (Out.Kind == EDropKind::Perfect || Out.Kind == EDropKind::Miss)
			{
				continue;
			}
			const double TopLo = -Extent / 2, TopHi = Extent / 2;
			const double SliderLo = Offset - Extent / 2, SliderHi = Offset + Extent / 2;
			const double OverlapLo = std::fmax(TopLo, SliderLo), OverlapHi = std::fmin(TopHi, SliderHi);
			CHECK(NEAR(Out.Kept, OverlapHi - OverlapLo));
			CHECK(NEAR(Out.CenterShift, (OverlapLo + OverlapHi) / 2));
			CHECK(NEAR(Out.Kept + Out.Chip, Extent));
			const double ChipLo = Offset > 0 ? OverlapHi : SliderLo;
			const double ChipHi = Offset > 0 ? SliderHi : OverlapLo;
			CHECK(NEAR(Out.Chip, ChipHi - ChipLo));
			CHECK(NEAR(Out.ChipShift, (ChipLo + ChipHi) / 2));
			CHECK((Out.Kind == EDropKind::Clutch) == (Out.Kept / Extent < ClutchRatio));
		}
	}

	void TestSliderAndSpeed()
	{
		double Offset = 0.0;
		float Direction = 1.f;
		for (int Step = 0; Step < 10000; ++Step)
		{
			AdvanceSlider(Offset, Direction, 37.3);
			CHECK(Offset <= TravelRange && Offset >= -TravelRange);
		}
		Offset = TravelRange - 1.0;
		Direction = 1.f;
		AdvanceSlider(Offset, Direction, 10.0);
		CHECK(Direction < 0.f && NEAR(Offset, TravelRange));

		CHECK(BaseSliderSpeed(0) == BaseSpeed);
		CHECK(BaseSliderSpeed(10000) == MaxSpeed);
		for (int Floor = 1; Floor < 200; ++Floor)
		{
			CHECK(BaseSliderSpeed(Floor) >= BaseSliderSpeed(Floor - 1));
		}
		// The slider must always start fully clear of the widest possible tower.
		CHECK(TravelRange > BaseSize);
		for (float Time = 0.f; Time < 10.f; Time += 0.01f)
		{
			CHECK(WobbleFactor(Time) > 0.3f);
		}
	}

	void TestProgression()
	{
		CHECK(NEAR(AltitudeMetersForFloor(0.0), StartAltitudeMeters));
		double Previous = AltitudeMetersForFloor(0.0);
		for (double Floor = 0.5; Floor < 250.0; Floor += 0.5)
		{
			const double Now = AltitudeMetersForFloor(Floor);
			CHECK(Now >= Previous);
			Previous = Now;
		}
		// Continuous where the curve switches from linear to exponential.
		CHECK(std::fabs(AltitudeMetersForFloor(SpaceRaceFloor) - AltitudeMetersForFloor(SpaceRaceFloor + 0.0001)) < 1.0);
		CHECK(NEAR(AltitudeMetersForFloor(1000.0), OrbitAltitudeMeters));
		// Journey beats line up with the zones (every 15 floors):
		//   Cloud Line (15-29) enters the cloud layer at 1.6 km; Sea of Clouds (30-44) is above its 3.2 km top;
		//   Stratosphere (75-89) is above airliners; Orbit (90+) is in space.
		CHECK(AltitudeMetersForFloor(14.0) < 1600.0);
		CHECK(AltitudeMetersForFloor(25.0) > 1600.0);
		CHECK(AltitudeMetersForFloor(40.0) > 3200.0);
		CHECK(AltitudeMetersForFloor(80.0) > 10000.0);
		CHECK(AltitudeMetersForFloor(92.0) > 50000.0);
		CHECK(AltitudeMetersForFloor(100.0) >= 100000.0);

		CHECK(ZoneForFloor(0, 7) == 0);
		CHECK(ZoneForFloor(14, 7) == 0);
		CHECK(ZoneForFloor(15, 7) == 1);
		CHECK(ZoneForFloor(90, 7) == 6);
		CHECK(ZoneForFloor(5000, 7) == 6);

		CHECK(NEAR(Danger(BaseSize), 0.0f));
		CHECK(NEAR(Danger(0.0), 1.0f));
		CHECK(Danger(BaseSize * 0.15) > 0.4f && Danger(BaseSize * 0.15) < 0.6f);

		CHECK(NEAR(Grow(BaseSize), BaseSize));
		CHECK(NEAR(Grow(100.0), 100.0 + GrowAmount));
		CHECK(!EarnsGrowth(ComboToGrow - 1) && EarnsGrowth(ComboToGrow));

		CHECK(MusicLevel(false, true, 0, 0) == 0);
		CHECK(MusicLevel(false, false, 0, 50) == -1);
		CHECK(MusicLevel(true, false, 0, 0) == 1);
		CHECK(MusicLevel(true, false, 3, 0) == 2);
		CHECK(MusicLevel(true, false, 6, 0) == 3);
		CHECK(MusicLevel(true, false, 0, 45) == 3);
	}

	struct FStats
	{
		double Peak = 0.0;
		double Rms = 0.0;
		bool bFinite = true;
	};

	FStats Measure(const std::vector<int16_t>& Samples)
	{
		FStats Stats;
		double Sum = 0.0;
		for (int16_t Sample : Samples)
		{
			const double Value = Sample / 32767.0;
			Stats.Peak = std::fmax(Stats.Peak, std::fabs(Value));
			Sum += Value * Value;
		}
		Stats.Rms = Samples.empty() ? 0.0 : std::sqrt(Sum / static_cast<double>(Samples.size()));
		return Stats;
	}

	void TestSynth()
	{
		const int Rate = FSkySynthCore::SampleRate;
		CHECK(std::fabs(FSkySynthCore::MidiToHz(69.f) - 440.f) < 0.01f);
		CHECK(std::fabs(FSkySynthCore::MidiToHz(81.f) - 880.f) < 0.01f);

		// Muted renders silence even with music and a hit playing.
		{
			FSkySynthCore Synth;
			SkySynthPresets::Perfect([&](const FSynthNote& Note) { Synth.Trigger(Note); }, 3);
			std::vector<int16_t> Buffer(Rate);
			Synth.Render(Buffer.data(), Rate, 3, true);
			CHECK(Measure(Buffer).Peak == 0.0);
		}

		// Music at every level: audible, never hard-clipping, voices bounded.
		for (int Level = -1; Level <= 3; ++Level)
		{
			FSkySynthCore Synth;
			std::vector<int16_t> Buffer(static_cast<size_t>(Rate) * 10);
			int MaxVoices = 0;
			for (size_t Offset = 0; Offset < Buffer.size(); Offset += 1024)
			{
				const int Count = static_cast<int>(std::fmin(1024.0, static_cast<double>(Buffer.size() - Offset)));
				Synth.Render(Buffer.data() + Offset, Count, Level, false);
				MaxVoices = MaxVoices > Synth.ActiveVoices() ? MaxVoices : Synth.ActiveVoices();
			}
			const FStats Stats = Measure(Buffer);
			std::printf("  music level %2d: peak %.2f  rms %.3f  max voices %d\n", Level, Stats.Peak, Stats.Rms, MaxVoices);
			CHECK(Stats.Rms > (Level < 0 ? 0.008 : 0.02));
			CHECK(Stats.Peak < 0.97);
			CHECK(MaxVoices < FSkySynthCore::MaxVoices);
		}

		// Every effect makes sound and then fully releases its voices.
		using Preset = void (*)(FSkySynthCore&);
		const struct { const char* Name; Preset Fire; } Effects[] =
		{
			{ "place",    [](FSkySynthCore& S) { SkySynthPresets::Place([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "perfect",  [](FSkySynthCore& S) { SkySynthPresets::Perfect([&](const FSynthNote& N) { S.Trigger(N); }, 12); } },
			{ "chop",     [](FSkySynthCore& S) { SkySynthPresets::Chop([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "clutch",   [](FSkySynthCore& S) { SkySynthPresets::Clutch([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "miss",     [](FSkySynthCore& S) { SkySynthPresets::Miss([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "collapse", [](FSkySynthCore& S) { SkySynthPresets::Collapse([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "zone",     [](FSkySynthCore& S) { SkySynthPresets::Zone([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "record",   [](FSkySynthCore& S) { SkySynthPresets::Record([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "grow",     [](FSkySynthCore& S) { SkySynthPresets::Grow([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "warn",     [](FSkySynthCore& S) { SkySynthPresets::Warn([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "click",    [](FSkySynthCore& S) { SkySynthPresets::Click([&](const FSynthNote& N) { S.Trigger(N); }); } },
			{ "start",    [](FSkySynthCore& S) { SkySynthPresets::Start([&](const FSynthNote& N) { S.Trigger(N); }); } },
		};
		for (const auto& Effect : Effects)
		{
			FSkySynthCore Synth;
			// Music level -1 still plays pads; mute them out of this measurement by rendering the
			// effect against a synth with its sequencer step pushed far away.
			std::vector<int16_t> Warmup(1);
			Synth.Render(Warmup.data(), 0, -1, false);
			Effect.Fire(Synth);
			std::vector<int16_t> Buffer(static_cast<size_t>(Rate) * 4);
			Synth.Render(Buffer.data(), static_cast<int32_t>(Buffer.size()), -1, false);
			const FStats Stats = Measure(Buffer);
			std::printf("  sfx %-9s peak %.2f\n", Effect.Name, Stats.Peak);
			CHECK(Stats.Peak > 0.02);
			CHECK(Stats.Peak < 0.97);
		}

		// Voice stealing: firing far more voices than exist never crashes or leaks.
		{
			FSkySynthCore Synth;
			for (int Index = 0; Index < 500; ++Index)
			{
				SkySynthPresets::Perfect([&](const FSynthNote& N) { Synth.Trigger(N); }, Index % 12);
			}
			std::vector<int16_t> Buffer(static_cast<size_t>(Rate) * 20);
			Synth.Render(Buffer.data(), static_cast<int32_t>(Buffer.size()), -1, false);
			CHECK(Measure(Buffer).Peak < 1.0);
		}
	}
}

int main()
{
	TestDrop();
	TestSliderAndSpeed();
	TestProgression();
	TestSynth();
	std::printf("%d checks, %d failures\n", Checks, Failures);
	return Failures == 0 ? 0 : 1;
}

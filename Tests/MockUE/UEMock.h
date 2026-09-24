#pragma once

// A compile-only stand-in for the slice of Unreal Engine that SkyStack uses. Signatures follow the
// engine's API (checked against the UE 5.5 Python API stub and open-source plugins); bodies are
// empty. Tests/compile_check.sh builds every game .cpp against this with -fsyntax-only to catch
// typos, scoping mistakes, wrong argument types and lambda return types before the real build.
// It deliberately keeps UE's strictness where it matters (e.g. FMath::Min(int, float) is an error,
// Printf rejects FString arguments, *_Lambda setters check the lambda's return type).

#include <atomic>
#include <cmath>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <memory>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

using int8 = int8_t;
using uint8 = uint8_t;
using int16 = int16_t;
using uint16 = uint16_t;
using int32 = int32_t;
using uint32 = uint32_t;
using int64 = int64_t;
using uint64 = uint64_t;
using TCHAR = wchar_t;

#define TEXT(x) L##x
#define UCLASS(...)
#define USTRUCT(...)
#define UENUM(...)
#define UPROPERTY(...)
#define UFUNCTION(...)
#define GENERATED_BODY() public: static UClass* StaticClass() { static UClass Class; return &Class; } private:
#define SKYSTACK_API
#define UE_ARRAY_COUNT(Array) (sizeof(Array) / sizeof((Array)[0]))
#define KINDA_SMALL_NUMBER (1.e-4f)
#define PI (3.1415926535897932f)
#define UE_TWO_PI (6.28318530717958647f)
#define INDEFINITELY_LOOPING_DURATION 10000.0f
#define IMPLEMENT_PRIMARY_GAME_MODULE(Impl, Name, GameName)
#define LOAD_NoWarn 0x1
#define LOAD_Quiet 0x2
#define LOCTEXT(Key, Str) FText::FromString(FString(TEXT(Str)))

class UClass {};

template <typename T>
struct TEnumAsByte
{
	TEnumAsByte() = default;
	TEnumAsByte(T In) : Value(In) {}
	operator T() const { return Value; }
	T Value{};
};

// ---------------------------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------------------------

class FString
{
public:
	FString() = default;
	FString(const TCHAR* In) : Data(In ? In : L"") {}
	const TCHAR* operator*() const { return Data.c_str(); }
	FString& operator+=(const TCHAR* Other) { Data += Other; return *this; }
	FString& operator+=(const FString& Other) { Data += Other.Data; return *this; }
	void AppendChar(TCHAR Char) { Data.push_back(Char); }
	int32 Len() const { return static_cast<int32>(Data.size()); }
	FString Mid(int32 Start, int32 Count) const { return FString(Data.substr(Start, Count).c_str()); }
	FString ToUpper() const { return *this; }
	bool IsEmpty() const { return Data.empty(); }
	friend FString operator/(const FString& A, const TCHAR* B) { return FString((A.Data + L"/" + B).c_str()); }

	template <typename... ArgTypes>
	static FString Printf(const TCHAR* Format, ArgTypes... Args)
	{
		static_assert(((std::is_arithmetic_v<ArgTypes> || std::is_pointer_v<ArgTypes> || std::is_enum_v<ArgTypes>) && ...),
			"FString::Printf arguments must be numbers or TCHAR pointers (use *String)");
		(void)Format;
		return FString();
	}

private:
	std::wstring Data;
};

#define UE_LOG(Category, Verbosity, Format, ...) ((void)FString::Printf(Format, ##__VA_ARGS__))

class FName
{
public:
	FName() = default;
	FName(const TCHAR* In) : Text(In) {}
	FName(const FString& In) : Text(In) {}
private:
	FString Text;
};
#define NAME_None FName()

class FText
{
public:
	static FText FromString(const FString& In) { FText Result; Result.Str = In; return Result; }
	static FText AsNumber(int32) { return FText(); }
	static FText AsNumber(int64) { return FText(); }
	static FText AsNumber(double) { return FText(); }
	static FText GetEmpty() { return FText(); }
	template <typename... ArgTypes>
	static FText Format(const FText& Pattern, ArgTypes&&... Args)
	{
		static_assert((std::is_same_v<std::decay_t<ArgTypes>, FText> && ...), "FText::Format arguments must be FText here");
		return Pattern;
	}
	FString ToString() const { return Str; }
private:
	FString Str;
};

// ---------------------------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------------------------

struct FVector2D;
struct FRotator;

template <typename T> constexpr bool TIsArith = std::is_arithmetic_v<T>;

struct FVector2f
{
	float X = 0.f, Y = 0.f;
	FVector2f() = default;
	FVector2f(float InX, float InY) : X(InX), Y(InY) {}
};

struct FVector2D
{
	double X = 0.0, Y = 0.0;
	FVector2D() = default;
	FVector2D(double InX, double InY) : X(InX), Y(InY) {}
	static const FVector2D ZeroVector;
	FVector2D operator+(const FVector2D& O) const { return { X + O.X, Y + O.Y }; }
	FVector2D operator-(const FVector2D& O) const { return { X - O.X, Y - O.Y }; }
	FVector2D operator*(const FVector2D& O) const { return { X * O.X, Y * O.Y }; }
	template <typename S, typename = std::enable_if_t<TIsArith<S>>> FVector2D operator*(S Scale) const { return { X * Scale, Y * Scale }; }
	FVector2D GetSafeNormal() const { return *this; }
};
inline const FVector2D FVector2D::ZeroVector{};

struct FVector
{
	double X = 0.0, Y = 0.0, Z = 0.0;
	FVector() = default;
	explicit FVector(double In) : X(In), Y(In), Z(In) {}
	FVector(double InX, double InY, double InZ) : X(InX), Y(InY), Z(InZ) {}
	FVector(const FVector2D& V, double InZ) : X(V.X), Y(V.Y), Z(InZ) {}
	static const FVector ZeroVector;
	static const FVector OneVector;
	static const FVector UpVector;
	FVector operator+(const FVector& O) const { return { X + O.X, Y + O.Y, Z + O.Z }; }
	FVector operator-(const FVector& O) const { return { X - O.X, Y - O.Y, Z - O.Z }; }
	FVector operator*(const FVector& O) const { return { X * O.X, Y * O.Y, Z * O.Z }; }
	FVector operator-() const { return { -X, -Y, -Z }; }
	template <typename S, typename = std::enable_if_t<TIsArith<S>>> FVector operator*(S Scale) const { return { X * Scale, Y * Scale, Z * Scale }; }
	template <typename S, typename = std::enable_if_t<TIsArith<S>>> FVector operator/(S Scale) const { return { X / Scale, Y / Scale, Z / Scale }; }
	FVector& operator+=(const FVector& O) { X += O.X; Y += O.Y; Z += O.Z; return *this; }
	template <typename S, typename = std::enable_if_t<TIsArith<S>>> FVector& operator*=(S Scale) { X *= Scale; Y *= Scale; Z *= Scale; return *this; }
	FVector& operator*=(const FVector& O) { X *= O.X; Y *= O.Y; Z *= O.Z; return *this; }
	double Size() const { return std::sqrt(X * X + Y * Y + Z * Z); }
	FVector GetSafeNormal() const { return *this; }
	FRotator Rotation() const;
};
inline const FVector FVector::ZeroVector{};
inline const FVector FVector::OneVector{ 1.0, 1.0, 1.0 };
inline const FVector FVector::UpVector{ 0.0, 0.0, 1.0 };

struct FVector4
{
	double X = 0, Y = 0, Z = 0, W = 0;
	FVector4() = default;
	FVector4(double InX, double InY, double InZ, double InW) : X(InX), Y(InY), Z(InZ), W(InW) {}
};

struct FRotator
{
	double Pitch = 0.0, Yaw = 0.0, Roll = 0.0;
	FRotator() = default;
	FRotator(double InPitch, double InYaw, double InRoll) : Pitch(InPitch), Yaw(InYaw), Roll(InRoll) {}
	static const FRotator ZeroRotator;
	FVector Vector() const { return FVector(); }
	FRotator operator+(const FRotator& O) const { return { Pitch + O.Pitch, Yaw + O.Yaw, Roll + O.Roll }; }
	template <typename S, typename = std::enable_if_t<TIsArith<S>>> FRotator operator*(S Scale) const { return { Pitch * Scale, Yaw * Scale, Roll * Scale }; }
};
inline const FRotator FRotator::ZeroRotator{};
inline FRotator FVector::Rotation() const { return FRotator(); }

struct FTransform
{
	FTransform() = default;
	FTransform(const FRotator&, const FVector&, const FVector&) {}
};

struct FColor
{
	uint8 R = 0, G = 0, B = 0, A = 255;
	FColor() = default;
	FColor(uint8 InR, uint8 InG, uint8 InB, uint8 InA = 255) : R(InR), G(InG), B(InB), A(InA) {}
};

struct FLinearColor
{
	float R = 0.f, G = 0.f, B = 0.f, A = 1.f;
	FLinearColor() = default;
	constexpr FLinearColor(float InR, float InG, float InB, float InA = 1.f) : R(InR), G(InG), B(InB), A(InA) {}
	explicit FLinearColor(const FColor&) {}
	static const FLinearColor White;
	static const FLinearColor Black;
	static const FLinearColor Transparent;
	FLinearColor operator*(float Scale) const { return { R * Scale, G * Scale, B * Scale, A * Scale }; }
	FLinearColor operator+(const FLinearColor& O) const { return { R + O.R, G + O.G, B + O.B, A + O.A }; }
	FLinearColor operator-(const FLinearColor& O) const { return { R - O.R, G - O.G, B - O.B, A - O.A }; }
	FLinearColor HSVToLinearRGB() const { return *this; }
};
inline const FLinearColor FLinearColor::White{ 1.f, 1.f, 1.f, 1.f };
inline const FLinearColor FLinearColor::Black{ 0.f, 0.f, 0.f, 1.f };
inline const FLinearColor FLinearColor::Transparent{ 0.f, 0.f, 0.f, 0.f };

struct FMath
{
	template <typename T> static T Min(T A, T B) { return A < B ? A : B; }
	template <typename T> static T Max(T A, T B) { return A > B ? A : B; }
	static double Min(float A, double B) { return A < B ? A : B; }
	static double Min(double A, float B) { return A < B ? A : B; }
	static double Max(float A, double B) { return A > B ? A : B; }
	static double Max(double A, float B) { return A > B ? A : B; }
	template <typename T> static T Clamp(T V, T Lo, T Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }
	template <typename T> static T Abs(T V) { return V < 0 ? -V : V; }
	template <typename T> static T Square(T V) { return V * V; }
	static float Sin(float V) { return std::sin(V); }
	static double Sin(double V) { return std::sin(V); }
	static float Cos(float V) { return std::cos(V); }
	static double Cos(double V) { return std::cos(V); }
	static float Exp(float V) { return std::exp(V); }
	static double Exp(double V) { return std::exp(V); }
	static float Loge(float V) { return std::log(V); }
	static double Loge(double V) { return std::log(V); }
	static float Asin(float V) { return std::asin(V); }
	static double Asin(double V) { return std::asin(V); }
	static float Pow(float A, float B) { return std::pow(A, B); }
	static float Fmod(float A, float B) { return std::fmod(A, B); }
	static double FloorToDouble(double V) { return std::floor(V); }
	static double RoundToDouble(double V) { return std::round(V); }
	static float RoundToFloat(float V) { return std::round(V); }
	template <typename T> static T RadiansToDegrees(T V) { return V; }
	static float SmoothStep(float A, float B, float X) { return A + B + X; }
	template <typename T, typename U> static T Lerp(const T& A, const T& B, const U& Alpha) { return A + (B - A) * Alpha; }
	template <typename T1, typename T2, typename T3, typename T4> static auto FInterpTo(T1 C, T2, T3, T4) { return C; }
	static FVector VInterpTo(const FVector& C, const FVector&, float, float) { return C; }
	template <typename T> static T FindDeltaAngleDegrees(T A, T B) { return B - A; }
	static float PerlinNoise1D(float V) { return V; }
	static int32 RandRange(int32 A, int32) { return A; }
	static float FRandRange(float A, float) { return A; }
	static double FRandRange(double A, double) { return A; }
	static bool RandBool() { return true; }
	static int32 Rand() { return 0; }
	static FVector VRand() { return FVector(); }
};

struct FRandomStream
{
	FRandomStream() = default;
	explicit FRandomStream(int32) {}
	void Initialize(int32) {}
	float FRand() const { return 0.f; }
	float FRandRange(float A, float) const { return A; }
	int32 RandRange(int32 A, int32) const { return A; }
};

// ---------------------------------------------------------------------------------------------
// Containers and smart pointers
// ---------------------------------------------------------------------------------------------

template <typename T>
class TArray
{
public:
	TArray() = default;
	TArray(std::initializer_list<T> In) : Items(In) {}
	int32 Add(const T& Item) { Items.push_back(Item); return Num() - 1; }
	T& AddDefaulted_GetRef() { Items.emplace_back(); return Items.back(); }
	void AddZeroed(int32 Count) { Items.resize(Items.size() + Count); }
	void Reset() { Items.clear(); }
	void Reserve(int32 Count) { Items.reserve(Count); }
	void SetNum(int32 Count) { Items.resize(Count); }
	void Init(const T& Value, int32 Count) { Items.assign(Count, Value); }
	int32 Num() const { return static_cast<int32>(Items.size()); }
	bool IsValidIndex(int32 Index) const { return Index >= 0 && Index < Num(); }
	void RemoveAt(int32 Index, int32 Count = 1) { Items.erase(Items.begin() + Index, Items.begin() + Index + Count); }
	void RemoveAtSwap(int32 Index) { Items[Index] = Items.back(); Items.pop_back(); }
	T& operator[](int32 Index) { return Items[Index]; }
	const T& operator[](int32 Index) const { return Items[Index]; }
	T* GetData() { return Items.data(); }
	auto begin() { return Items.begin(); }
	auto end() { return Items.end(); }
	auto begin() const { return Items.begin(); }
	auto end() const { return Items.end(); }
private:
	std::vector<T> Items;
};

template <typename T>
class TObjectPtr
{
public:
	TObjectPtr() = default;
	TObjectPtr(std::nullptr_t) {}
	TObjectPtr(T* In) : Ptr(In) {}
	template <typename U, typename = std::enable_if_t<std::is_convertible_v<U*, T*>>> TObjectPtr(U* In) : Ptr(In) {}
	operator T*() const { return Ptr; }
	T* operator->() const { return Ptr; }
	T* Get() const { return Ptr; }
private:
	T* Ptr = nullptr;
};

template <typename T>
class TWeakObjectPtr
{
public:
	TWeakObjectPtr() = default;
	TWeakObjectPtr(T* In) : Ptr(In) {}
	bool IsValid() const { return Ptr != nullptr; }
	T* Get() const { return Ptr; }
	T* operator->() const { return Ptr; }
private:
	T* Ptr = nullptr;
};

template <typename T> class TSharedRef;

template <typename T>
class TSharedPtr
{
public:
	TSharedPtr() = default;
	TSharedPtr(std::shared_ptr<T> In) : Ptr(std::move(In)) {}
	template <typename U, typename = std::enable_if_t<std::is_convertible_v<U*, T*>>> TSharedPtr(const TSharedRef<U>& In);
	template <typename U, typename = std::enable_if_t<std::is_convertible_v<U*, T*>>> TSharedPtr(const TSharedPtr<U>& In) : Ptr(In.Std()) {}
	bool IsValid() const { return Ptr != nullptr; }
	void Reset() { Ptr.reset(); }
	T* operator->() const { return Ptr.get(); }
	TSharedRef<T> ToSharedRef() const;
	const std::shared_ptr<T>& Std() const { return Ptr; }
private:
	std::shared_ptr<T> Ptr;
};

template <typename T>
class TSharedRef
{
public:
	explicit TSharedRef(std::shared_ptr<T> In) : Ptr(std::move(In)) {}
	template <typename U, typename = std::enable_if_t<std::is_convertible_v<U*, T*>>> TSharedRef(const TSharedRef<U>& In) : Ptr(In.Std()) {}
	T* operator->() const { return Ptr.get(); }
	T& Get() const { return *Ptr; }
	const std::shared_ptr<T>& Std() const { return Ptr; }
private:
	std::shared_ptr<T> Ptr;
};
template <typename T> template <typename U, typename> TSharedPtr<T>::TSharedPtr(const TSharedRef<U>& In) : Ptr(In.Std()) {}
template <typename T> TSharedRef<T> TSharedPtr<T>::ToSharedRef() const { return TSharedRef<T>(Ptr); }

template <typename T> using TOptional = std::optional<T>;
template <typename Sig> using TFunction = std::function<Sig>;

enum class EQueueMode { Spsc, Mpsc };
template <typename T, EQueueMode Mode = EQueueMode::Spsc>
class TQueue
{
public:
	bool Enqueue(const T&) { return true; }
	bool Dequeue(T&) { return false; }
};

// ---------------------------------------------------------------------------------------------
// Time, paths, platform
// ---------------------------------------------------------------------------------------------

struct FTimespan { double GetTotalDays() const { return 0.0; } };
struct FDateTime
{
	FDateTime(int32, int32, int32) {}
	static FDateTime UtcNow() { return FDateTime(2026, 1, 1); }
	FTimespan operator-(const FDateTime&) const { return FTimespan(); }
};
struct FApp { static double GetDeltaTime() { return 0.016; } };
struct FPaths
{
	static FString ProjectContentDir() { return FString(); }
	static bool FileExists(const FString&) { return true; }
};
struct FPlatformApplicationMisc { static void ClipboardCopy(const TCHAR*) {} };
class FDefaultGameModuleImpl {};

// ---------------------------------------------------------------------------------------------
// UObject, actors, components
// ---------------------------------------------------------------------------------------------

class UWorld;
class UObject
{
public:
	virtual ~UObject() = default;
	UWorld* GetWorld() const { return nullptr; }
	template <typename T> T* CreateDefaultSubobject(FName) { return new T(); }
};
struct FObjectInitializer {};
template <typename T> T* NewObject(UObject* Outer = nullptr)
{
	(void)Outer;
	if constexpr (std::is_constructible_v<T, const FObjectInitializer&>) { return new T(FObjectInitializer()); }
	else { return new T(); }
}
template <typename T> decltype(auto) MoveTemp(T&& Value) { return std::move(Value); }
template <typename T, typename U> T* Cast(U* In) { return dynamic_cast<T*>(In); }
template <typename T, typename U> T* Cast(const TObjectPtr<U>& In) { return dynamic_cast<T*>(In.Get()); }
template <typename T> T* LoadObject(UObject*, const TCHAR*, const TCHAR* = nullptr, uint32 = 0) { return nullptr; }
inline bool IsValid(const UObject* Object) { return Object != nullptr; }

template <typename T>
class TSubclassOf
{
public:
	TSubclassOf() = default;
	TSubclassOf(UClass* In) : Class(In) {}
private:
	UClass* Class = nullptr;
};

namespace EComponentMobility { enum Type { Static, Stationary, Movable }; }
namespace ECollisionEnabled { enum Type { NoCollision, QueryOnly, PhysicsOnly, QueryAndPhysics }; }
namespace EEndPlayReason { enum Type { Destroyed, LevelTransition, EndPlayInEditor, RemovedFromWorld, Quit }; }
namespace EQuitPreference { enum Type { Quit, Background }; }
enum class ESpawnActorCollisionHandlingMethod : uint8 { Undefined, AlwaysSpawn };

class UActorComponent : public UObject
{
public:
	uint8 bAutoActivate : 1;
	void MarkRenderStateDirty() {}
};

class USceneComponent : public UActorComponent
{
public:
	void SetupAttachment(USceneComponent*) {}
	void SetUsingAbsoluteLocation(bool) {}
	void SetUsingAbsoluteRotation(bool) {}
	void SetMobility(EComponentMobility::Type) {}
	void SetRelativeRotation(const FRotator&) {}
	void SetWorldLocation(const FVector&) {}
	void SetWorldRotation(const FRotator&) {}
	void SetWorldLocationAndRotation(const FVector&, const FRotator&) {}
	FVector GetComponentLocation() const { return FVector(); }
	void SetVisibility(bool) {}
};

class UMaterialInterface : public UObject {};
class UStaticMesh : public UObject {};

class UMaterialInstanceDynamic : public UMaterialInterface
{
public:
	static UMaterialInstanceDynamic* Create(UMaterialInterface*, UObject*) { return nullptr; }
	void SetVectorParameterValue(FName, const FLinearColor&) {}
	void SetScalarParameterValue(FName, float) {}
};

class UPrimitiveComponent : public USceneComponent
{
public:
	bool SetCollisionProfileName(FName) { return true; }
	void SetCollisionEnabled(ECollisionEnabled::Type) {}
	void SetGenerateOverlapEvents(bool) {}
	void SetCastShadow(bool) {}
	void SetSimulatePhysics(bool) {}
	bool IsSimulatingPhysics() const { return false; }
	void SetPhysicsLinearVelocity(FVector, bool = false, FName = NAME_None) {}
	void SetPhysicsAngularVelocityInDegrees(FVector, bool = false, FName = NAME_None) {}
	void SetAffectDistanceFieldLighting(bool) {}
	void SetAffectDynamicIndirectLighting(bool) {}
	void SetMaterial(int32, UMaterialInterface*) {}
	UMaterialInterface* GetMaterial(int32) const { return nullptr; }
};

class UStaticMeshComponent : public UPrimitiveComponent
{
public:
	bool SetStaticMesh(UStaticMesh*) { return true; }
};

class UInstancedStaticMeshComponent : public UStaticMeshComponent
{
public:
	void SetNumCustomDataFloats(int32) {}
	TArray<int32> AddInstances(const TArray<FTransform>&, bool, bool = false, bool = true) { return {}; }
	bool BatchUpdateInstancesTransforms(int32, const TArray<FTransform>&, bool = false, bool = false, bool = false) { return true; }
	bool SetCustomDataValue(int32, int32, float, bool = false) { return true; }
};

struct UCollisionProfile
{
	static inline FName BlockAll_ProfileName{ TEXT("BlockAll") };
	static inline FName PhysicsActor_ProfileName{ TEXT("PhysicsActor") };
};

enum EAutoExposureMethod { AEM_Histogram, AEM_Basic, AEM_Manual };
struct FPostProcessSettings
{
	uint8 bOverride_AutoExposureMinBrightness : 1, bOverride_AutoExposureMaxBrightness : 1, bOverride_AutoExposureSpeedUp : 1,
		bOverride_AutoExposureSpeedDown : 1, bOverride_AutoExposureBias : 1, bOverride_BloomIntensity : 1, bOverride_LensFlareIntensity : 1,
		bOverride_VignetteIntensity : 1, bOverride_SceneFringeIntensity : 1, bOverride_MotionBlurAmount : 1, bOverride_FilmGrainIntensity : 1,
		bOverride_ColorSaturation : 1, bOverride_ColorContrast : 1, bOverride_SceneColorTint : 1, bOverride_DepthOfFieldFstop : 1,
		bOverride_DepthOfFieldFocalDistance : 1;
	float AutoExposureMinBrightness, AutoExposureMaxBrightness, AutoExposureSpeedUp, AutoExposureSpeedDown, AutoExposureBias,
		BloomIntensity, LensFlareIntensity, VignetteIntensity, SceneFringeIntensity, MotionBlurAmount, FilmGrainIntensity,
		DepthOfFieldFstop, DepthOfFieldFocalDistance;
	FVector4 ColorSaturation, ColorContrast;
	FLinearColor SceneColorTint;
};

class UCameraComponent : public USceneComponent
{
public:
	void SetFieldOfView(float) {}
	uint8 bConstrainAspectRatio : 1;
	float PostProcessBlendWeight = 1.f;
	FPostProcessSettings PostProcessSettings;
};

class ULightComponent : public USceneComponent
{
public:
	void SetIntensity(float) {}
	void SetLightColor(FLinearColor, bool = true) {}
};
class UDirectionalLightComponent : public ULightComponent
{
public:
	void SetAtmosphereSunLight(bool) {}
	void SetAtmosphereSunLightIndex(int32) {}
	void SetLightSourceAngle(float) {}
};
enum ESkyLightSourceType { SLS_CapturedScene, SLS_SpecifiedCubemap };
class USkyLightComponent : public USceneComponent
{
public:
	TEnumAsByte<ESkyLightSourceType> SourceType;
	bool bRealTimeCapture = false;
	void SetIntensity(float) {}
};
enum class ESkyAtmosphereTransformMode : uint8 { PlanetTopAtAbsoluteWorldOrigin, PlanetTopAtComponentTransform, PlanetCenterAtComponentTransform };
class USkyAtmosphereComponent : public USceneComponent
{
public:
	ESkyAtmosphereTransformMode TransformMode{};
	void SetGroundAlbedo(const FColor&) {}
};
class UVolumetricCloudComponent : public USceneComponent
{
public:
	void SetLayerBottomAltitude(float) {}
	void SetLayerHeight(float) {}
	void SetMaterial(UMaterialInterface*) {}
};
class UExponentialHeightFogComponent : public USceneComponent
{
public:
	void SetFogDensity(float) {}
	void SetFogHeightFalloff(float) {}
	void SetVolumetricFog(bool) {}
	void SetVolumetricFogScatteringDistribution(float) {}
};
class UPostProcessComponent : public USceneComponent
{
public:
	uint32 bUnbound : 1;
	FPostProcessSettings Settings;
};

// Audio
enum class EVirtualizationMode : uint8 { Disabled, PlayWhenSilent, Restart, SeekRestart };
enum EDecompressionType { DTYPE_Setup, DTYPE_Procedural };
enum ESoundGroup { SOUNDGROUP_Default };
enum class ESoundWavePrecacheState { NotStarted, InProgress, Done };
class USoundBase : public UObject
{
public:
	EVirtualizationMode VirtualizationMode{};
	float Duration = 0.f;
};
class USoundWave : public USoundBase
{
public:
	int32 NumChannels = 0;
	uint8 bLooping : 1;
	uint8 bProcedural : 1;
	TEnumAsByte<EDecompressionType> DecompressionType;
	TEnumAsByte<ESoundGroup> SoundGroup;
	void SetSampleRate(uint32) {}
protected:
	void SetPrecacheState(ESoundWavePrecacheState) {}
};
class USoundWaveProcedural : public USoundWave
{
public:
	USoundWaveProcedural() = default;
	explicit USoundWaveProcedural(const FObjectInitializer&) {}
	virtual int32 OnGeneratePCMAudio(TArray<uint8>&, int32) { return 0; }
};
class UAudioComponent : public USceneComponent
{
public:
	uint8 bAllowSpatialization : 1;
	uint8 bIsUISound : 1;
	void SetSound(USoundBase*) {}
	void Play(float = 0.f) {}
};

// Input
struct FKey { FKey() = default; };
struct EKeys
{
	static inline FKey SpaceBar, LeftMouseButton, Enter, Gamepad_FaceButton_Bottom, Gamepad_Special_Right, R,
		Gamepad_FaceButton_Left, Escape, Tab, Gamepad_FaceButton_Right, D, E, Left, Right, Up, Down,
		Gamepad_DPad_Left, Gamepad_DPad_Right, C, Gamepad_FaceButton_Top, M;
};
enum EInputEvent { IE_Pressed, IE_Released };
namespace ETouchIndex { enum Type { Touch1, Touch2 }; }
class UInputComponent : public UActorComponent
{
public:
	template <typename UserClass> void BindKey(const FKey, EInputEvent, UserClass*, void (UserClass::*)()) {}
	template <typename UserClass> void BindTouch(EInputEvent, UserClass*, void (UserClass::*)(ETouchIndex::Type, FVector)) {}
};

// Actors
struct FActorTickFunction { uint8 bCanEverTick : 1; uint8 bStartWithTickEnabled : 1; };
struct FActorSpawnParameters { ESpawnActorCollisionHandlingMethod SpawnCollisionHandlingOverride{}; };

class AActor : public UObject
{
public:
	virtual void BeginPlay() {}
	virtual void EndPlay(const EEndPlayReason::Type) {}
	virtual void Tick(float) {}
	bool SetActorLocation(const FVector&) { return true; }
	FVector GetActorLocation() const { return FVector(); }
	void SetActorScale3D(const FVector&) {}
	void AddActorWorldOffset(const FVector&) {}
	void AddActorWorldRotation(const FRotator&) {}
	bool Destroy() { return true; }
	void SetLifeSpan(float) {}
	void SetActorTickEnabled(bool) {}
	FActorTickFunction PrimaryActorTick;
	USceneComponent* RootComponent = nullptr;
};

class AController : public AActor {};
class APawn : public AActor
{
public:
	uint32 bUseControllerRotationPitch : 1, bUseControllerRotationYaw : 1, bUseControllerRotationRoll : 1;
	virtual void SetupPlayerInputComponent(UInputComponent*) {}
	AController* GetController() const { return nullptr; }
};

enum class EMouseLockMode : uint8 { DoNotLock, LockOnCapture, LockAlways };
struct FInputModeDataBase { virtual ~FInputModeDataBase() = default; };
struct FInputModeGameAndUI : FInputModeDataBase
{
	FInputModeGameAndUI& SetHideCursorDuringCapture(bool) { return *this; }
	FInputModeGameAndUI& SetLockMouseToViewportBehavior(EMouseLockMode) { return *this; }
};
class APlayerController : public AController
{
public:
	void SetInputMode(const FInputModeDataBase&) {}
	uint32 bShowMouseCursor : 1;
	APawn* GetPawn() const { return nullptr; }
};

class USaveGame : public UObject {};

class AGameModeBase : public AActor
{
public:
	TSubclassOf<APawn> DefaultPawnClass;
	TSubclassOf<AActor> HUDClass;
};

class SWidget;
class UGameViewportClient : public UObject
{
public:
	void AddViewportWidgetContent(TSharedRef<SWidget>, const int32 = 0) {}
	void RemoveViewportWidgetContent(TSharedRef<SWidget>) {}
};

class UWorld : public UObject
{
public:
	template <typename T> T* SpawnActor(UClass*, const FVector&, const FRotator&, const FActorSpawnParameters& = FActorSpawnParameters()) { return nullptr; }
	UGameViewportClient* GetGameViewport() const { return nullptr; }
};

class AHUD : public AActor
{
public:
	APlayerController* GetOwningPlayerController() const { return nullptr; }
};

struct UGameplayStatics
{
	static void SetGlobalTimeDilation(const UObject*, float) {}
	static USaveGame* LoadGameFromSlot(const FString&, const int32) { return nullptr; }
	static USaveGame* CreateSaveGameObject(TSubclassOf<USaveGame>) { return nullptr; }
	static bool SaveGameToSlot(USaveGame*, const FString&, const int32) { return true; }
};
struct UKismetSystemLibrary
{
	static void QuitGame(const UObject*, APlayerController*, TEnumAsByte<EQuitPreference::Type>, bool) {}
};

namespace ConstructorHelpers
{
	template <typename T>
	struct FObjectFinder
	{
		explicit FObjectFinder(const TCHAR*) {}
		bool Succeeded() const { return Object != nullptr; }
		T* Object = nullptr;
	};
}

// ---------------------------------------------------------------------------------------------
// Slate
// ---------------------------------------------------------------------------------------------

struct EVisibility
{
	static const EVisibility Visible, Collapsed, Hidden, HitTestInvisible, SelfHitTestInvisible;
	int Value = 0;
	bool operator==(const EVisibility& O) const { return Value == O.Value; }
};
inline const EVisibility EVisibility::Visible{ 0 }, EVisibility::Collapsed{ 1 }, EVisibility::Hidden{ 2 },
	EVisibility::HitTestInvisible{ 3 }, EVisibility::SelfHitTestInvisible{ 4 };

enum EHorizontalAlignment { HAlign_Fill, HAlign_Left, HAlign_Center, HAlign_Right };
enum EVerticalAlignment { VAlign_Fill, VAlign_Top, VAlign_Center, VAlign_Bottom };
namespace ETextJustify { enum Type { Left, Center, Right }; }

struct FMargin
{
	FMargin() = default;
	FMargin(float) {}
	FMargin(float, float) {}
	FMargin(float, float, float, float) {}
};
struct FSlateColor
{
	FSlateColor() = default;
	FSlateColor(const FLinearColor&) {}
};
struct FFontOutlineSettings { int32 OutlineSize = 0; FLinearColor OutlineColor; };
struct FSlateFontInfo
{
	FSlateFontInfo() = default;
	FSlateFontInfo(const FString&, float) {}
	int32 LetterSpacing = 0;
	FFontOutlineSettings OutlineSettings;
};
struct FCoreStyle { static FSlateFontInfo GetDefaultFontStyle(const FName, const float) { return FSlateFontInfo(); } };

namespace ESlateBrushDrawType { enum Type { NoDrawType, Box, Border, Image, RoundedBox }; }
struct FSlateBrush { TEnumAsByte<ESlateBrushDrawType::Type> DrawAs; };
struct FSlateRoundedBoxBrush : FSlateBrush
{
	FSlateRoundedBoxBrush(const FLinearColor&, float = 0.f) {}
	FSlateRoundedBoxBrush(const FLinearColor&, float, const FLinearColor&, float) {}
};
struct FSlateColorBrush : FSlateBrush { explicit FSlateColorBrush(const FLinearColor&) {} };
struct FButtonStyle
{
	FButtonStyle& SetNormal(const FSlateBrush&) { return *this; }
	FButtonStyle& SetHovered(const FSlateBrush&) { return *this; }
	FButtonStyle& SetPressed(const FSlateBrush&) { return *this; }
	FButtonStyle& SetNormalPadding(const FMargin&) { return *this; }
	FButtonStyle& SetPressedPadding(const FMargin&) { return *this; }
};
struct FOptionalSize { FOptionalSize() = default; FOptionalSize(float) {} };
struct FReply { static FReply Handled() { return FReply(); } };
struct FGeometry {};
struct FSlateRenderTransform
{
	explicit FSlateRenderTransform(float UniformScale, const FVector2f& Translation = FVector2f()) { (void)UniformScale; (void)Translation; }
};

template <typename T>
class TAttribute
{
public:
	TAttribute() = default;
	TAttribute(const T&) {}
	template <typename U, typename = std::enable_if_t<std::is_convertible_v<U, T> && !std::is_invocable_v<U>>> TAttribute(const U&) {}
};

class SWidget
{
public:
	virtual ~SWidget() = default;
	void SetVisibility(TAttribute<EVisibility>) {}
};

/** Common arguments every Slate widget accepts, with *_Lambda variants that check return types. */
#define MOCK_ATTR(Type, Name) \
	Derived& Name(TAttribute<Type>) { return static_cast<Derived&>(*this); } \
	template <typename F> Derived& Name##_Lambda(F&& Fn) \
	{ \
		static_assert(std::is_convertible_v<std::invoke_result_t<F>, Type>, #Name "_Lambda must return " #Type); \
		(void)Fn; return static_cast<Derived&>(*this); \
	}
#define MOCK_ARG(Type, Name) Derived& Name(Type) { return static_cast<Derived&>(*this); }

template <typename Derived>
struct TSlateBaseArgs
{
	MOCK_ATTR(EVisibility, Visibility)
	MOCK_ATTR(TOptional<FSlateRenderTransform>, RenderTransform)
	MOCK_ARG(FVector2D, RenderTransformPivot)
};

template <typename Derived>
struct TSlateContentArgs : TSlateBaseArgs<Derived>
{
	Derived& operator[](const TSharedRef<SWidget>&) { return static_cast<Derived&>(*this); }
};

template <typename WidgetType>
struct TDecl
{
	template <typename ArgsType>
	TSharedRef<WidgetType> operator<<=(const ArgsType& Args) const
	{
		auto Widget = std::make_shared<WidgetType>();
		Widget->Construct(Args);
		return TSharedRef<WidgetType>(Widget);
	}
};
template <typename WidgetType>
struct TDeclAssign
{
	TSharedPtr<WidgetType>& Target;
	template <typename ArgsType>
	TSharedRef<WidgetType> operator<<=(const ArgsType& Args) const
	{
		auto Result = TDecl<WidgetType>() <<= Args;
		Target = TSharedPtr<WidgetType>(Result);
		return Result;
	}
};
#define SNew(WidgetType) TDecl<WidgetType>() <<= typename WidgetType::FArguments()
#define SAssignNew(Target, WidgetType) TDeclAssign<WidgetType>{ Target } <<= typename WidgetType::FArguments()

#define SLATE_BEGIN_ARGS(WidgetType) public: struct FArguments : public TSlateBaseArgs<FArguments> { using Derived = FArguments; FArguments()
#define SLATE_ARGUMENT(Type, Name) Type _##Name{}; FArguments& Name(Type In) { _##Name = In; return *this; }
#define SLATE_END_ARGS() };

struct FChildSlot { void operator[](const TSharedRef<SWidget>&) {} };
class SCompoundWidget : public SWidget
{
public:
	virtual void Tick(const FGeometry&, const double, const float) {}
protected:
	FChildSlot ChildSlot;
};

template <typename Derived>
struct TBoxSlotArgs
{
	Derived& HAlign(EHorizontalAlignment) { return static_cast<Derived&>(*this); }
	Derived& VAlign(EVerticalAlignment) { return static_cast<Derived&>(*this); }
	Derived& Padding(const FMargin&) { return static_cast<Derived&>(*this); }
	Derived& operator[](const TSharedRef<SWidget>&) { return static_cast<Derived&>(*this); }
};

class SVerticalBox : public SWidget
{
public:
	struct FSlot : TBoxSlotArgs<FSlot>
	{
		FSlot& AutoHeight() { return *this; }
		FSlot& FillHeight(float) { return *this; }
	};
	static FSlot Slot() { return FSlot(); }
	struct FArguments : TSlateBaseArgs<FArguments> { FArguments& operator+(const FSlot&) { return *this; } };
	void Construct(const FArguments&) {}
	FSlot AddSlot() { return FSlot(); }
};
class SHorizontalBox : public SWidget
{
public:
	struct FSlot : TBoxSlotArgs<FSlot>
	{
		FSlot& AutoWidth() { return *this; }
		FSlot& FillWidth(float) { return *this; }
	};
	static FSlot Slot() { return FSlot(); }
	struct FArguments : TSlateBaseArgs<FArguments> { FArguments& operator+(const FSlot&) { return *this; } };
	void Construct(const FArguments&) {}
};
class SOverlay : public SWidget
{
public:
	struct FSlot : TBoxSlotArgs<FSlot> {};
	static FSlot Slot() { return FSlot(); }
	struct FArguments : TSlateBaseArgs<FArguments> { FArguments& operator+(const FSlot&) { return *this; } };
	void Construct(const FArguments&) {}
};

class STextBlock : public SWidget
{
public:
	struct FArguments : TSlateBaseArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(FText, Text)
		MOCK_ATTR(FSlateFontInfo, Font)
		MOCK_ATTR(FSlateColor, ColorAndOpacity)
		MOCK_ATTR(FVector2D, ShadowOffset)
		MOCK_ATTR(FLinearColor, ShadowColorAndOpacity)
		MOCK_ATTR(ETextJustify::Type, Justification)
		MOCK_ATTR(bool, AutoWrapText)
	};
	void Construct(const FArguments&) {}
};

class SBorder : public SWidget
{
public:
	struct FArguments : TSlateContentArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(const FSlateBrush*, BorderImage)
		MOCK_ATTR(FMargin, Padding)
		MOCK_ATTR(FLinearColor, ColorAndOpacity)
		MOCK_ATTR(FSlateColor, BorderBackgroundColor)
		MOCK_ARG(EHorizontalAlignment, HAlign)
		MOCK_ARG(EVerticalAlignment, VAlign)
	};
	void Construct(const FArguments&) {}
};

class SBox : public SWidget
{
public:
	struct FArguments : TSlateContentArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(FOptionalSize, WidthOverride)
		MOCK_ATTR(FOptionalSize, HeightOverride)
		MOCK_ATTR(FMargin, Padding)
		MOCK_ARG(EHorizontalAlignment, HAlign)
		MOCK_ARG(EVerticalAlignment, VAlign)
	};
	void Construct(const FArguments&) {}
};

class SButton : public SWidget
{
public:
	struct FArguments : TSlateContentArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ARG(const FButtonStyle*, ButtonStyle)
		MOCK_ARG(bool, IsFocusable)
		MOCK_ATTR(FMargin, ContentPadding)
		MOCK_ARG(EHorizontalAlignment, HAlign)
		MOCK_ARG(EVerticalAlignment, VAlign)
		template <typename F> FArguments& OnClicked_Lambda(F&& Fn)
		{
			static_assert(std::is_same_v<std::invoke_result_t<F>, FReply>, "OnClicked_Lambda must return FReply");
			(void)Fn; return *this;
		}
	};
	void Construct(const FArguments&) {}
};

class SImage : public SWidget
{
public:
	struct FArguments : TSlateBaseArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(const FSlateBrush*, Image)
		MOCK_ATTR(FSlateColor, ColorAndOpacity)
	};
	void Construct(const FArguments&) {}
};

class SSpacer : public SWidget
{
public:
	struct FArguments : TSlateBaseArgs<FArguments> {};
	void Construct(const FArguments&) {}
};

class SBackgroundBlur : public SWidget
{
public:
	struct FArguments : TSlateContentArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(float, BlurStrength)
	};
	void Construct(const FArguments&) {}
};

class SUniformGridPanel : public SWidget
{
public:
	struct FSlot { FSlot& operator[](const TSharedRef<SWidget>&) { return *this; } };
	struct FArguments : TSlateBaseArgs<FArguments>
	{
		using Derived = FArguments;
		MOCK_ATTR(FMargin, SlotPadding)
	};
	void Construct(const FArguments&) {}
	FSlot AddSlot(int32, int32) { return FSlot(); }
	void ClearChildren() {}
};

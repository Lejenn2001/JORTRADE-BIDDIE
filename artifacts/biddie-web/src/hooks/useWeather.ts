import { useState, useEffect } from "react";

interface WeatherData {
  temp: number;
  condition: string;
  icon: string;
  location: string;
}

const getConditionFromCode = (code: number): { condition: string; icon: string } => {
  if (code === 0) return { condition: "Clear", icon: "☀️" };
  if (code <= 3) return { condition: "Cloudy", icon: "⛅" };
  if (code <= 48) return { condition: "Foggy", icon: "🌫️" };
  if (code <= 57) return { condition: "Drizzle", icon: "🌦️" };
  if (code <= 67) return { condition: "Rainy", icon: "🌧️" };
  if (code <= 77) return { condition: "Snowy", icon: "❄️" };
  if (code <= 82) return { condition: "Showers", icon: "🌧️" };
  if (code <= 86) return { condition: "Snow Showers", icon: "🌨️" };
  if (code >= 95) return { condition: "Thunderstorm", icon: "⛈️" };
  return { condition: "Clear", icon: "☀️" };
};

export const getBiddieOutfit = (condition: string): string => {
  switch (condition) {
    case "Clear": return "rocking sunglasses and a cap 😎";
    case "Cloudy": return "cozy in a hoodie 🧥";
    case "Foggy": return "mysterious in a trench coat 🕵️";
    case "Drizzle":
    case "Rainy":
    case "Showers": return "splashing in rain boots ☂️";
    case "Snowy":
    case "Snow Showers": return "bundled up in a beanie and scarf 🧣";
    case "Thunderstorm": return "charged up in storm gear ⚡";
    default: return "looking fresh as always 🤖";
  }
};

const fetchWeatherByCoords = async (lat: number, lon: number): Promise<WeatherData> => {
  let cityName = "Your Area";
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1`
    );
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      cityName = geoData.results?.[0]?.name || "Your Area";
    }
  } catch {
    // ignore
  }

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`
  );
  const data = await res.json();
  const code = data.current?.weather_code ?? 0;
  const { condition, icon } = getConditionFromCode(code);
  return {
    temp: Math.round(data.current?.temperature_2m ?? 70),
    condition,
    icon,
    location: cityName,
  };
};

export const useWeather = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Dallas fallback coords
    const fallback = async () => {
      const data = await fetchWeatherByCoords(32.7767, -96.7970);
      if (data.location === "Your Area") data.location = "Dallas, TX";
      setWeather(data);
      setLoading(false);
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const data = await fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude);
            setWeather(data);
          } catch {
            await fallback();
          }
          setLoading(false);
        },
        async () => {
          await fallback();
        },
        { timeout: 5000 }
      );
    } else {
      fallback();
    }
  }, []);

  return { weather, loading };
};

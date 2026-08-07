// Open-Meteo access (free, keyless, CORS-enabled). No DOM code here.

export async function geocodeCity(name) {
  const params = new URLSearchParams({ name, count: "1" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status})`);
  }
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) return null;
  return { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
}

// Hourly temperature + rain probability for the next 16 days, in the
// location's own timezone.
export async function fetchForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "temperature_2m,precipitation_probability,weather_code",
    forecast_days: "16",
    timezone: "auto",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    throw new Error(`Forecast failed (${res.status})`);
  }
  const data = await res.json();
  return {
    time: data.hourly.time,
    temperature: data.hourly.temperature_2m,
    precipProb: data.hourly.precipitation_probability,
    weatherCode: data.hourly.weather_code,
  };
}

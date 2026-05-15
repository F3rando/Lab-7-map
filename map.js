// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { MAPBOX_ACCESS_TOKEN } from './config.local.js';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Token lives in gitignored config.local.js (see config.example.js)
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

let timeFilter = -1;

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, tf) {
  return tf === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - tf) <= 60 ||
          Math.abs(endedMinutes - tf) <= 60
        );
      });
}

function computeStationTraffic(stations, tripRows) {
  const departures = d3.rollup(
    tripRows,
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    tripRows,
    (v) => v.length,
    (d) => d.end_station_id,
  );
  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Shared line styling for Boston + Cambridge bike layers (lab Step 2.3 optional refactor)
const bikeLanePaint = {
  'line-color': 'green',
  'line-width': 3,
  'line-opacity': 0.4,
};

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  let stations;
  try {
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
    stations = jsonData.data.stations;
    console.log('Stations Array:', stations);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  let trips;
  try {
    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );
  } catch (error) {
    console.error('Error loading traffic CSV:', error);
    return;
  }

  stations = computeStationTraffic(stations, trips);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const svg = d3.select('#map').select('svg');

  let circles;

  function updatePositions() {
    svg
      .selectAll('circle')
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  function updateScatterPlot(tf) {
    const filteredTrips = filterTripsByTime(trips, tf);
    const filteredStations = computeStationTraffic(stations, filteredTrips);
    tf === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('stroke-width', 1);
    circles.each(function (d) {
      const sel = d3.select(this);
      let title = sel.select('title');
      if (title.empty()) title = sel.append('title');
      title.text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
    });
    updatePositions();
  }

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});

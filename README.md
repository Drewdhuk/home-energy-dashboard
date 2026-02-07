# Home Energy Dashboard (Home Assistant Lovelace Card)

A **NetZero-style** energy dashboard card for Home Assistant with **6 graphs**:

1. Solar (actual) + forecast (optional)  
2. Grid (power) with **Peak / Off-peak / Dispatch shading**, a **dashed p/kWh trend line**, and **net £** for the selected period  
3. Battery (power + SoC)  
4. Home load  
5. Heat pump (power) with **outside temperature overlay**  
6. EV charger power  

Includes:
- Range tabs: **24h / 7d / 30d / This Year / Last Year**
- **Export CSV** button (exports what you’re currently viewing)
- Designed for **HACS easy install/uninstall**

---


## 5‑minute install (novice quick path)

1. Upload this repo to GitHub (files in the root).
2. Add it in HACS as a **Frontend** custom repository.
3. Install it from HACS.
4. If needed, add the resource:
   - `/hacsfiles/home-energy-dashboard/home-energy-dashboard-card.js` (JavaScript Module)
5. Add the card using the YAML example below (already includes your Octopus rate entities).

---


## Easy install (HACS) — beginner steps

### 1) Create the GitHub repo
1. Go to GitHub and create a new repository named: **Home-Energy-Dashboard**
2. Upload the files from this zip into the repo (keep them in the root)
3. (Optional but recommended) Create a release tag like **v1.4** so HACS can download a zip release

### 2) Add as a Custom Repository in HACS
1. In Home Assistant, open **HACS**
2. Go to **Frontend**
3. Tap the **3 dots (⋮)** → **Custom repositories**
4. Paste your GitHub repo URL
5. Select **Category: Frontend**
6. Click **Add**

### 3) Install
1. In HACS → **Frontend**, find **Home Energy Dashboard**
2. Click **Download/Install**
3. Reload your browser (or restart Home Assistant if asked)

### 4) Add the resource (only if HACS doesn’t do it automatically)
Home Assistant → **Settings → Dashboards → Resources → Add Resource**
- URL:  
  `/hacsfiles/home-energy-dashboard/home-energy-dashboard-card.js`
- Type: **JavaScript Module**

---


## Your confirmed Octopus rate entities (already checked ✅)

Use these exact entities in your card config:

- **Import rate**: `sensor.octopus_energy_electricity_15p0138047_2380001118334_current_rate`  (state is in **£/kWh**)
- **Export rate**: `sensor.octopus_energy_electricity_15p0138047_2394300431811_export_current_rate`  (state is in **£/kWh**)

The card automatically converts these to **p/kWh** for the dashed trend line and calculates **net £** correctly.

---

## Add the card to a dashboard

### Example YAML (matches your setup)
Edit dashboard → **Add card** → **Manual** → paste:

```yaml
type: custom:home-energy-dashboard-card
title: Home Energy Dashboard
refresh_seconds: 60
range: day
show_range_tabs: true
show_export: true
max_points: 220

entities:
  # Solar
  solar_power: sensor.my_home_solar_power

  # Grid (signed W preferred; +import, -export)
  grid_power: sensor.myenergi_my_home_power_grid

  # Battery
  battery_power: sensor.battery_power
  battery_soc: sensor.percentage_charged

  # Home load
  home_power: sensor.load_power

  # Heat pump
  heatpump_power: sensor.my_home_device_0_arotherm_plus_current_power

  # Outside temperature overlay
  outdoor_temp: sensor.my_home_outdoor_temperature

  # EV charger
  ev_power: sensor.myenergi_zappi_22161822_power_ct_internal_load

  # Octopus / tariff shading + dispatch chip
  tariff_state: sensor.nz_tariff_state
  dispatch_active: binary_sensor.octopus_energy_00000000_0009_4000_8020_000000049d45_intelligent_dispatching

  # Octopus rates (REPLACE with your exact entity IDs)
  import_rate: sensor.octopus_energy_electricity_15p0138047_2380001118334_current_rate
  export_rate: sensor.octopus_energy_electricity_15p0138047_2394300431811_export_current_rate

options:
  invert_grid: false
  invert_battery: false
```

### Find your Octopus rate entity IDs (novice method)
1. Go to **Developer Tools → States**
2. Search: `octopus_energy` then `current_rate`
3. Copy the full entity id for:
   - the **import** current rate (usually ends with `_current_rate`)
   - the **export** current rate (usually ends with `_export_current_rate`)

> The card auto-detects whether your rate sensors are in **£/kWh** or **p/kWh**.

---

## Tariff state sensor (recommended)

To color the grid background for **Peak / Off-peak / Dispatch**, use a template sensor that outputs:
- `dispatch` (when dispatching is on)
- otherwise `off_peak` or `peak` based on time

Example template (edit times if your off-peak window differs):

```yaml
template:
  - sensor:
      - name: "NZ Tariff State"
        unique_id: nz_tariff_state
        state: >
          {% if is_state('binary_sensor.octopus_energy_00000000_0009_4000_8020_000000049d45_intelligent_dispatching', 'on') %}
            dispatch
          {% else %}
            {% set t = now().strftime('%H:%M') %}
            {% if '23:30' <= t or t < '05:30' %}
              off_peak
            {% else %}
              peak
            {% endif %}
          {% endif %}
```

---

## Uninstall
1. HACS → **Frontend** → **Home Energy Dashboard** → **Uninstall**
2. Remove the card from your dashboard(s)
3. Refresh Home Assistant / browser

---

## Troubleshooting
- **Graph says “No data”**: the sensor may not have history yet (Recorder needs time), or it’s not a numeric sensor.
- **Grid import/export looks backwards**: set `options.invert_grid: true`.
- **Battery charging/discharging looks backwards**: set `options.invert_battery: true`.
- **No tariff shading**: ensure `entities.tariff_state` exists and changes between `peak/off_peak/dispatch`.

---

## Version
Card version: **v1.4**

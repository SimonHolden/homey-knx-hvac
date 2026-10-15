# KNX HVAC for Homey

A Homey app (SDK v3, Homey Pro) that adds a KNX thermostat device with full DPT 20.105 HVAC mode support.
Built around the Daikin Intesis KNX module, but it works with any thermostat or HVAC gateway that exposes
these objects.

## What a thermostat device can do

Every object is optional. Fill in only the group addresses that exist, and only the matching controls appear.

| Object | DPT | Homey capability |
|---|---|---|
| On/Off (control and status) | 1.001 | `onoff` |
| HVAC mode (control and status) | 20.105 | `hvac_mode` (picker) |
| Heat/Cool (control and status) | 1.100 | `hvac_mode` (heat and cool only) |
| Fan speed (control and status) | 5.001 or 5.010 | `fan_speed` (picker) |
| Fan auto (control and status) | 1.001 | `fan_speed` (adds Auto) |
| Setpoint (control and status) | 9.001 | `target_temperature` |
| Room / return temperature (status) | 9.001 | `measure_temperature` |
| Room temperature from a flow (send) | 9.001 | written by the "Set room temperature" card |

### Choosing which modes are exposed

The device settings list all 19 DPT 20.105 values (0 Auto, 1 Heat, 2 Morning warmup, 3 Cool, 4 Night purge,
5 Precool, 6 Off, 7 Test, 8 Emergency heat, 9 Fan only, 10 Free cooling, 11 Ice making, 12 Maximum heating,
13 Economic heat/cool, 14 Dry, 15 Calibration, 16 Emergency cool, 17 Emergency steam, 20 No demand).
Tick the ones your unit supports. Auto, Heat, Cool, Fan only and Dry are ticked by default, which matches the
Intesis Daikin module. Only ticked modes show in the Homey picker and in flow cards. A telegram carrying a
mode that is not ticked is ignored.

### The simple heat/cool object

If a thermostat only has the binary heat/cool object (DPT 1.100, 0 = cool, 1 = heat), enter just those
addresses. The mode picker then offers Heat and Cool. If both the 20.105 mode and the heat/cool object are
filled in, 20.105 is authoritative for the displayed mode, and the heat/cool control address is also written
whenever Heat or Cool is selected so both objects stay in sync.

### Fan speed

Choose 2 speeds (Low, High) or 3 speeds (Low, Medium, High), and the data type of the fan object:

- Percentage (DPT 5.001): sends 50/100 % for 2 speeds, or 33/67/100 % for 3 speeds. Received percentages snap
  to the nearest speed; 0 % is ignored.
- Enumerated (DPT 5.010): sends the speed number, starting at 1 (default) or 0 to match the gateway.

If the 1-bit fan auto object is set (1 = auto, 0 = manual), Auto is added to the picker. Choosing Auto writes 1
to the auto address. Choosing a fixed speed writes 0 to the auto address, then the speed. While the auto status
is 1, the picker shows Auto.

### Flow cards

- Trigger: HVAC mode changed (tokens: mode id and mode name)
- Trigger: HVAC mode changed to...
- Condition: HVAC mode is / is not...
- Action: Set HVAC mode
- The same four cards for fan speed (changed, changed to, is, set), shown only for devices with a fan object
- Action: Set room temperature (°C). Use it to feed the thermostat's room temperature from another sensor.
  Tick "Room temperature is set by a flow" in the device settings so the temperature shows without a KNX
  status address. Values outside -50 to 100 °C are ignored, and values are rounded to 0.1 °C. If a room
  temperature status address is also set, whichever updated last is shown. If "Send flow value to address"
  is set, the value is also written to that group address, for example the external temperature input of an
  AC gateway. Setting this address on its own is enough to show the room temperature on the device.

The mode dropdowns only list the modes ticked for that device. On/off and temperature use Homey's standard
thermostat cards.

## Install

1. Install the Homey CLI: `npm install -g homey`, then `homey login`.
2. In this folder run `npm install`, then `homey app run` to test it on your Homey Pro,
   or `homey app install` to keep it installed.
3. Open the app settings in Homey and set the KNX connection:
   - Tunnelling: the address of your KNX/IP interface (port 3671).
   - Routing: a KNX/IP router, default multicast address 224.0.23.12.
4. Add a device: Devices, add, KNX HVAC, KNX Thermostat. Then open the device settings and enter the group
   addresses (3-level format, for example `1/0/3`).

For the Intesis Daikin module, the objects map like this: 0 and 47 On/Off, 1 and 48 Mode (20.105),
2 and 49 Cool/Heat (1.100), 24 and 69 Setpoint, 70 Return temperature. Enter the group address linked to
each object in ETS.

## Notes

- One shared KNX connection is used for all devices. Tunnelling uses up one tunnel slot on your interface.
- Current values are requested from the bus on start and after every reconnect.
- While not connected, the app retries every 15 seconds with a fresh connection. When the app stops it closes
  the tunnel cleanly so the interface frees the slot. If the app was stopped without that (for example a crash),
  the interface keeps the old tunnel for up to 2 minutes, and the app connects as soon as it is released.
- The alarm object is not included yet.
- `lib/hvac-modes.js` is the single list of modes. After editing it, run `node scripts/generate-compose.js`.

## License

GPL-3.0. See [LICENSE](LICENSE).

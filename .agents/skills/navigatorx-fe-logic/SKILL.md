---
name: navigatorx-fe-logic
description: Complete logic of NavigatorX Frontend mapping, routing, online map matching, driving directions, rerouting, simulation, search, and UI features. Use when working on or debugging the frontend mapping logic.
---

# NavigatorX Frontend Mapping & Routing Logic

This skill explains the core mapping, routing, online map matching, driving directions, dynamic rerouting logic, search, and simulation mode within the NavigatorX Frontend Next.js application, specifically focusing on `app/page.tsx`, `app/simulation/page.tsx`, `app/ui/map.tsx`, `app/ui/routing.tsx`, and associated libraries.

## Objectives of the NextJS NavigatorX Map Project

The primary objectives of this project are:
1. **Search and Routing**: Create a map (similar to Google Maps, Apple Maps, Waze, etc.) that provides the fastest route and alternative routes—along with driving directions, ETA information, and distance metrics—when a user enters a search query for an origin and destination.
2. **Turn-by-Turn Navigation**: Provide real-time navigation features (like Google Maps, Apple Maps, Waze, etc.). When a user initiates navigation (by clicking the "Navigate" button on a selected route), the map delivers the next closest turn-by-turn instruction based on the specific road segment/edge the user is on (determined by online map matching). 
   - **Rerouting**: If the user deviates from the selected route while navigating, the map automatically reroutes, providing a new path in the same direction as the user's current trajectory.
   - **Dynamic Alternatives**: The map also intelligently provides alternative route suggestions on-the-fly when the user approaches major intersections or decision points.

## 1. Online Map Matching

Online map matching aligns noisy raw GPS coordinates from the device to actual road segments (edges) on the map in real-time.

### Mechanism:
- **Initialization**: Triggered when `routeStarted` is set to `true`. Establishes a WebSocket connection to the backend Map Matcher service (`NEXT_PUBLIC_MAP_MATCH_WS_URL`).
- **Data Collection**: Uses `navigator.geolocation.watchPosition` to get device GPS updates at high frequency (up to 1 update/sec depending on OS).
- **Speed Calculation**: If device doesn't report speed directly, it calculates speed using Haversine distance between consecutive GPS points divided by `delta_time`.
- **WebSocket Request (`MapMatchRequest`)**: Sends raw `gps_point` (lat, lon, speed, delta_time, dead_reckoning flag), step number `k`, previous `candidates`, `speed_mean_k`, `speed_std_k`, and `last_bearing`.
- **Dead Reckoning Fallback**: If GPS signal is lost (e.g., timeout or unavailable error) and the time since last GPS point exceeds `LOST_GPS_THRESHOLD`, the app enters dead reckoning mode. It predicts the current GPS coordinate based on the previous known coordinate and speed, and sends a dead reckoning request to the WS.
- **WebSocket Response Handling**: 
  - Backend responds with the actual `matched_coord` (lat, lon) on the road, `predicted_gps_coord` (for dead reckoning validation), `candidates`, and most importantly: **`edge_id` (snappedEdgeID)**.
  - Updates React state `snappedEdgeID` which drives routing logic.
- **Smooth Marker Animation (60 FPS)**: Instead of updating React state on every frame (which causes "Maximum update depth exceeded" errors), `map.tsx` relies on `gsap` (GreenSock) inside an imperative loop. It animates the `currentGpsLocRef` and `currentHeadingRef` values from their current positions to the newly received `matched_coord` over the estimated travel duration, calculating intermediate positions smoothly at 60 FPS using `requestAnimationFrame`.

## 2. Driving Directions

Driving directions are fetched from the routing engine and displayed contextually as the user drives.

### Mechanism:
- **Routing API**: Initiated by `fetchRouteCRP`, which returns a `RouteCRPResponse` containing the full polyline `path` and an array of `driving_directions`.
- **Direction Structure**: Each direction step contains:
  - `edge_ids`: The sequence of road segment IDs that make up this specific direction.
  - `turn_point`: Latitude and longitude of where the maneuver/turn happens.
  - `turn_type`: e.g., `TURN_RIGHT`, `KEEP_LEFT`, `CONTINUE_ONTO`.
  - `turn_bearing`: Angle for the UI arrow icon.
  - `suggest_alternatives`: Boolean flag indicating if this edge is an opportunity to suggest dynamic alternatives.
- **Current Direction Calculation**: In the sync loop of `page.tsx`, `getCurrentUserDirectionIndex` iterates through `driving_directions`. It checks which direction's `edge_ids` array contains the current `snappedEdgeID`.
- **Distance to Turn**: Uses `getDistanceFromUserToNextTurn` (Haversine) from the current `matchedGpsLoc` to the current direction's `nextTurnPoint`.
- **UI Rendering**: `MapComponent` filters and renders turn markers. Zoom-level-based scaling is applied to turn icons, rotating them based on `turn_bearing - userHeading`. `Router` component shows the step-by-step turn instructions.

## 3. Reroute Logic

Rerouting happens automatically when the user deviates from the active path.

### Mechanism:
- **Off-Route Detection**: `isUserOffTheRoute` is checked inside a `useEffect` whenever `snappedEdgeID` changes. It loops through all `edge_ids` in all `driving_directions` of the current route. If `snappedEdgeID` is not found in the set of the route's edges, the user is off-route.
- **Alternative Match Check**: Before requesting a completely new route from the backend, the app checks if the user simply switched to one of the previously fetched alternative routes (`otherRouteIndex`). If true, it just switches `activeRoute` without an API call.
- **API Reroute Request**: If genuinely off-route, and the map match step is beyond the initial buffer (e.g., `mapMatchStep > 5` to prevent false positive reroutes at startup), a reroute API call is made to both `fetchRouteCRP` and `fetchAlternativeRoutes`.
- **Payload**: The payload includes `reroute: true`, `startEdgeId: snappedEdgeID`, and the current user location as the new source.
- **State Reset**: `routeData` is replaced, `polylineData` is redrawn, and `activeRoute` is reset to `0`.

## 4. Alternative Routes Suggestion (Dynamic Alternatives)

Suggests alternative routes dynamically as the user approaches specific intersections or decision points.

### Mechanism:
- **Trigger**: Checked on every snapped edge update. Uses `isNearEndOfSuggestAlternativesStep`.
- **Condition**: Checks if the current direction step has `suggest_alternatives == true`, and if the current `snappedEdgeID` is among the **last 3 edges** of this direction step's `edge_ids` array.
- **Dynamic Fetch**: If the condition is met and it hasn't fetched alternatives for this specific direction index yet (`lastFetchedAlternativesStep`), it triggers an async background call to `fetchAlternativeRoutes(reqBody)` using `startEdgeId: snappedEdgeID`.
- **UI Update**: When the backend responds with new alternatives, it combines them with the *existing* main route (`routeData[0]`) and updates `alternativeRoutesLineData`. These new alternative polylines instantly appear on the map as the user approaches the intersection, allowing them to visibly choose a new path without interrupting current navigation.

## 5. Search & Geocoding

The application supports searching for destinations and querying user locations.

### Mechanism:
- **Forward Geocoding (`fetchSearch`)**:
  - Activated from the search boxes in the UI (`app/ui/routing.tsx`).
  - Calls a Photon API (`NEXT_PUBLIC_SEARCH_API_URL`) passing the text `query`, `lat`, and `lon` (for location-biased results).
  - Normalizes the response into an array of `Place` objects, handling street, housenumber, district, city, state, and country.
- **Reverse Geocoding (`fetchReverseGeocoding`)**:
  - Triggered when the user clicks the "Your Location" GPS button.
  - Sends the current device coordinates to the Photon API reverse geocoding endpoint.
  - Extracts the closest address to automatically populate the `source` or `destination` fields.
- **URL Sync**: Selected sources and destinations are synchronized with URL search parameters (e.g., `?source=...&destination=...`), allowing route states to be shareable.

## 6. Simulation Mode

Found in `app/simulation/page.tsx`, this feature allows developers and testers to replay GPS traces to verify map matching and routing behavior without physical movement.

### Mechanism:
- **Data Loading**: Loads an array of predefined `points` (raw GPS data).
- **Execution Loop**: Uses an imperative loop (with delays) to step through each GPS point. The delay is calculated from the time differences (`datetime_utc`) to match real-time driving speeds, subject to a `MIN_SPEED_THRESHOLD`.
- **Map Matching Config**: Users can toggle between WebSocket mode (`isUsingWebSocket`) or HTTP polling.
- **GPS Window Buffer**: Can visually render a window of raw GPS points around the current point (`isShowingGpsWindow`), creating a red dot buffer on the map to visualize raw input noise versus the snapped route.
- **Animation and Events**: It uses the same imperative `gsap.to` animation block and distance thresholds as the live application to accurately test UI responsiveness. At the end, it allows downloading a log of the matched points (edge IDs and coordinates).

## 7. UI Components & Visuals

The application's UI is divided into the interactive Map layer and the floating UI components.

### Mechanism:
- **MapComponent (`app/ui/map.tsx`)**:
  - Built on `@vis.gl/react-maplibre`.
  - Dynamically renders layers using `Source` and `Layer` for `spRouteGeoJSON` (main path) and `alternativeRoutes` paths.
  - Dynamically applies styles such as `ACTIVE_ROUTE_COLOR` and zoom-based widths (`ACTIVE_ROUTE_WIDTH_BY_ZOOM`).
  - `GeolocateControl` and `NavigationControl` provide native map interactions.
  - Incorporates context menus for setting source and destination directly via long-press (mobile) or right-click.
- **Router UI (`app/ui/routing.tsx`)**:
  - Provides a responsive card-based layout (bottom sheet on mobile, sidebar on desktop).
  - Displays route summaries (ETA, distance) and step-by-step turn instructions.
  - Uses specific icons generated via `getTurnIcon` mapping API turn types (e.g., `TURN_RIGHT`) to static image files (`/icons/turn_right.png`).

## 8. Testing Guidelines

**Every time you change the code, you MUST test your code by running all features.**

Specifically, when verifying the **Online Map Matching** functionality:
- Use the **Simulation Page** feature (`app/simulation/page.tsx`).
- Run the simulation using the dataset `"data/noisy_data_wgs84_3_5_1_0.csv"`.
- Ensure that you verify the map behavior and UI responsiveness across multiple viewports: **desktop, tablet, and mobile device views**.
- **Zero Errors**: Ensure that there are absolutely no errors or warnings (e.g., "Maximum update depth exceeded", rendering crashes) in the browser console when trying and testing any feature, particularly during the high-frequency map matching process.

// Google Maps directions URL — universal (opens the installed Maps
// app on Android/iOS, or google.com/maps on desktop). Origin is
// omitted so Maps uses the user's device location; passing our
// origin coords instead would leak them into the outgoing URL.

export function googleMapsDirections(destLat: number, destLng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving`
}

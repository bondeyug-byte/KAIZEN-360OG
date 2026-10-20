// Campus-wide settings. Edit these for your college.

// Campus location: VESIT, Hashu Advani Memorial Complex, Collector Colony, Chembur (Google Maps place
// coordinates, checked Oct 2026). VESIM shares the complex. Railway-station pins come from data/network.js
// (approximate). Other ride pins are wherever students place them.
export const CAMPUS_CENTER = { lat: 19.045879, lng: 72.889285, label: 'VESIT, Collector Colony, Chembur', isPlaceholder: false }
export const VESIM_LOCATION = { lat: 19.045393, lng: 72.889605, label: 'VESIM, Collector Colony, Chembur' }

export const CAMPUS_TIMEZONE = 'Asia/Kolkata'
export const STARTING_SOON_MINUTES = 120

export const CLASSES = ['FE-A', 'FE-B', 'FE-C', 'FE-D']
export const CLASS_LABEL = { 'FE-A': 'FE Div A · CMPN / IT', 'FE-B': 'FE Div B · AI & DS', 'FE-C': 'FE Div C · EXTC', 'FE-D': 'FE Div D · Robotics', 'SE-A': 'SE · Computer Engg', ALL: 'All first-years' }

export const INTEREST_OPTIONS = ['coding', 'robotics', 'ai', 'electronics', 'design', 'music', 'dance', 'photography', 'debate', 'chess', 'cricket', 'entrepreneurship', 'volunteering']

/** Small fixed offsets (degrees) from CAMPUS_CENTER for demo pins. */
export const pin = (dLat, dLng) => ({ lat: +(CAMPUS_CENTER.lat + dLat).toFixed(6), lng: +(CAMPUS_CENTER.lng + dLng).toFixed(6) })

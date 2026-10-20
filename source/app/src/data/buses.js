// BEST bus routes at stops near the VES campus (Collector Colony, Chembur).
// Sources (checked 15 Oct 2026):
//  - Moovit stop pages for "Chembur Colony" and "Chembur Colony Chembur (E)" — route list, destinations,
//    and the early-morning departures Moovit prints (it does not publish a full-day table).
//  - VES contact page (vbs.ves.ac.in/contact-vbs) — 432 from Kurla to the Vivekanand College stop (9 min walk),
//    364 from Chembur East to the Chembur Camp stop (10 min walk).
// BEST does not publish full-day timetables for these routes, so "every" is the gap between the sample
// departures and next-bus times are ESTIMATES. Always shown with that label in the UI.

export const BUS_SOURCE = {
  checked: '2026-10-15',
  note: 'Routes and sample times from Moovit stop pages and the VES contact page. BEST does not publish full-day timetables, so waits are estimates. Use the BEST Chalo app for live arrivals.',
  links: [
    { label: 'Moovit — Chembur Colony stop', url: 'https://moovitapp.com/index/en/public_transit-Chembur_Colony-Mumbai-stop_43570705-3732' },
    { label: 'Moovit — Chembur Colony Chembur (E) stop', url: 'https://moovitapp.com/index/en/public_transit-Chembur_Colony_Chembur_E-Mumbai-stop_16219923-3732' },
    { label: 'VES — how to reach Collector Colony campus', url: 'https://vbs.ves.ac.in/contact-vbs' },
  ],
}

// sample: departures as printed by Moovit from that stop, towards `toward` (24h "HH:MM").
export const BUS_STOPS = [
  {
    id: 'chembur-colony',
    name: 'Chembur Colony',
    where: 'Choitram Gidwani Marg (Kolwada–Borla Road), Chembur',
    walk: null,
    routes: [
      { no: '501 LTD', ends: ['Kurla Bus Station (E)', 'Airoli Bus Station'], sample: { toward: 'Airoli Bus Station', times: ['04:29', '04:44', '04:59', '05:14', '05:29', '05:44', '05:59', '06:14', '06:29', '06:44', '06:59', '07:14'] }, first: '04:27', last: '02:32' },
      { no: '361', ends: ['Kurla Bus Station (E)', 'Mahul Village'], sample: { toward: 'Mahul Village', times: ['05:09', '05:21', '05:33', '05:45', '05:57', '06:09'] }, last: '01:29' },
      { no: '363', ends: ['Kurla Bus Station (E)', 'Mahul Village'], sample: { toward: 'Mahul Village', times: ['06:08'] } },
      { no: 'A-362', ends: ['Deonar Depot', 'Kurla Bus Station (E)'], sample: { toward: 'Deonar Depot', times: ['05:53', '06:08', '06:23', '06:38', '06:53', '07:08'] } },
      { no: 'A-364', ends: ['Trombay / Anushakti Nagar', 'Mahul Village'], sample: { toward: 'Trombay', times: ['06:28', '06:48', '07:08'] } },
      { no: 'A-663', ends: ['Trombay', '—'], sample: { toward: 'Trombay', times: ['06:43', '07:13'] } },
      { no: 'A-399', ends: ['Deonar Depot / Anushakti Nagar / Trombay', 'Mulund Check Naka (W)'], sample: { toward: 'Anushakti Nagar', times: ['06:46', '07:01'] } },
      { no: 'A-381', ends: ['Ghatkopar Station (E)', 'Tata Power Centre (Mahul)'], sample: { toward: 'Tata Power Centre (Mahul)', times: ['05:22', '05:25', '05:37', '05:45', '05:52', '06:05', '06:07'] } },
      { no: 'A-383', ends: ['Shivaji Nagar Bus Station', 'Gadkari Quarry'], sample: { toward: 'Gadkari Quarry', times: ['05:50', '06:05'] } },
      { no: 'A-430', ends: ['Ghatkopar Station (E)', 'Mahul Village'] },
      { no: 'A-431', ends: ['Kurla Bus Station (E)', 'Tata Power Centre (Mahul)'] },
      { no: 'A-367', ends: ['Kurla Bus Station (E)', 'Gadkari Quarry'] },
      { no: 'A-369', ends: ['Kurla Bus Station (E)', 'Vashi Naka (Chembur) SRA Colony'] },
      { no: 'A-373', ends: ['Vaishali Nagar (Mulund)', 'Mahul Village'] },
      { no: 'A-351', ends: ['Mumbai Central Depot', 'Tata Power Centre (Mahul)'] },
      { no: 'A-356', ends: ['Santacruz Depot', 'Vashi Naka (Chembur) SRA Colony'] },
      { no: 'A-6 / 6 LTD', ends: ['Backbay Depot', 'Tata Power Centre (Mahul)'] },
      { no: 'A-21', ends: ['Museum (Dr. S. P. Mukherjee Chowk)', 'Anushakti Nagar / Deonar Depot / Trombay'] },
      { no: 'AC-26', ends: ['Shivaji Nagar Bus Station', 'Colaba Depot (Electric House)'] },
    ],
  },
  {
    id: 'vivekanand-college',
    name: 'Vivekanand College',
    where: 'Collector Colony, Chembur',
    walk: '9 min walk to the Collector Colony campus (VES)',
    routes: [{ no: '432', ends: ['Kurla Bus Station (E)', 'Kurla Bus Station (E) — loop'], note: 'From Kurla station (E). Recommended by VES.' }],
  },
  {
    id: 'chembur-camp',
    name: 'Chembur Camp',
    where: 'Chembur',
    walk: '10 min walk to the VES campus (VES)',
    routes: [{ no: '364', ends: ['Chembur (E)', '—'], note: 'From Chembur station (E). Recommended by VES.' }],
  },
]

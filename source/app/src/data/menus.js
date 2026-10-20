// Canteen menus transcribed from the team's photos (16 Oct 2026). Only items with a clearly readable price are
// included (team's rule: leave unpriced or unreadable items out). Prices in ₹. Admins can edit everything.
// VESIT: printed milkshake & juice boards + the canteen's handwritten price list.
// VESIM: the canteen's own list (shared by a student, Parth Khot), drinks seen in the fridge, and the readable
//        boards of Anuj Caterers. The VESIM menu is PARTIAL — clearer photos of the Anuj Caterers boards are pending.
const V = 'VESIT', M = 'VESIM'
const RAW = {
  [V]: {
    Milkshakes: [['Chikoo milkshake', 35], ['Apple milkshake', 45], ['Banana milkshake', 30], ['Mango milkshake (seasonal)', 45], ['Oreo milkshake', 40], ['Custard milkshake (seasonal)', 45], ['Strawberry milkshake (seasonal)', 45], ['Pineapple milkshake', 40], ['Anjeer milkshake (seasonal)', 45], ['Chocolate milkshake', 40], ['Cold coffee', 40], ['Butterscotch', 40], ['Mix milkshake', 40], ['Rose milkshake', 40], ['Strawberry milkshake (Mepro)', 40], ['Oreo cold coffee mix', 40], ['Chikoo chocolate mix', 40], ['Oreo chocolate mix', 40]],
    'Fresh juice': [['Mast mosambi juice', 30], ['Anna ananas juice', 30], ['Orange juice', 30], ['Watermelon juice', 20], ['Maramari (pineapple + mosambi)', 30], ['Ganga Jamuna (orange + mosambi)', 30], ['Saraswati (pineapple + mosambi + orange)', 30], ['Grapes juice', 40], ['Cocktail juice (mixed fruits)', 35], ['Muskmelon juice', 35]],
    Sandwiches: [['Veg sandwich', 35], ['Veg toast sandwich', 40], ['Veg grilled sandwich', 60], ['Veg cheese grilled sandwich', 80], ['Bread butter', 30], ['Bread butter toast', 35], ['Cheese chilli toast', 80]],
    Combos: [['Any can of Red Bull + paneer chilli', 215], ['Any can of Red Bull + egg schezwan fried rice', 195]],
    Meals: [['Lunch', 63], ['Veg biryani', 68], ['Veg pulav', 74], ['Dal rice', 42], ['Dal khichdi', 77], ['Paneer sabzi', 30], ['Puri bhaji', 60], ['Puri plate', 30], ['Plain rice', 20]],
    Snacks: [['Tea (full)', 12], ['Coffee', 20], ['Lassi', 25], ['Dahi', 20], ['Pav', 4], ['Poha', 32], ['Upma', 32], ['Potato vada', 14], ['Punjabi samosa', 15], ['Chinese samosa', 24], ['Dahi kachori', 77], ['Chole bhature', 53], ['Chole pattice', 53], ['Misal pav', 40], ['Sabudana vada', 40], ['Bread pakoda', 18], ['French fries', 80], ['Veg frankie', 40]],
    'South Indian': [['Idli sambar', 32], ['Medu vada', 40], ['Idli vada sambar', 40], ['Sada dosa', 42], ['Masala dosa', 63], ['Onion uttapa', 53], ['Mini uttapa', 48]],
    Chinese: [['Fried rice', 58], ['Hakka noodles', 58], ['Egg fried rice', 63], ['Egg noodles', 63], ['Veg manchurian', 56]],
  },
  [M]: {
    'Breakfast & snacks': [['Chai', 15], ['Coffee', 20], ['Misal', 50], ['Idli', 40], ['Vada', 50], ['Poha', 35], ['Vada pav', 20], ['Samosa', 20], ['Bread pakora', 20]],
    Meals: [['Thali', 80], ['Dal khichdi (without tadka)', 70], ['Dal khichdi (with tadka)', 80], ['Chapati bhaji', 60], ['Manchurian', 50], ['Korean noodles', 80], ['Pasta', 65]],
    'Chinese (Anuj Caterers)': [['Veg schezwan fried rice', 85], ['Veg hakka noodles', 80], ['Veg schezwan hakka noodles', 85], ['Veg manchurian fried rice', 110], ['Veg manchurian hakka noodles', 110], ['Veg triple fried rice', 140], ['Veg combination rice', 120], ['Egg fried rice', 100], ['Egg schezwan fried rice', 105], ['Egg hakka noodles', 100], ['Egg schezwan hakka noodles', 105], ['Egg triple fried rice', 150], ['Egg combination rice', 140]],
    'Chaat (Anuj Caterers)': [['Dahi puri', 60], ['Sev puri', 50], ['Pani puri', 35], ['Masala puri', 40], ['Sukha bhel', 35], ['Gila bhel', 45], ['Aloo chaat', 50], ['Samosa chaat', 60], ['Dahi samosa chaat', 75], ['Papdi chaat', 50], ['Dahi papdi chaat', 60]],
    'Maggi (Anuj Caterers)': [['Maggi', 50], ['Maggi veggie', 65], ['Maggi cheese', 65], ['Maggi veggie cheese', 80], ['Maggi cheese schezwan', 70], ['Maggi veggie cheese schezwan', 90], ['Maggi omelette', 70], ['Maggi omelette schezwan', 75], ['Maggi veggie omelette', 80], ['Maggi omelette cheese', 80], ['Maggi omelette veggie schezwan', 90], ['Maggi omelette cheese schezwan', 90], ['Maggi omelette veggie cheese', 100], ['Korean ramen', 80]],
    Beverages: [['Water (small)', 10], ['Water (big)', 20], ['Pepsi', 20], ['Pepsi Black (diet)', 20], ['Jeera soda', 20], ['Cream Bell Maxxum Java coffee shake', 30], ['Cream Bell Maxxum double chocolate shake', 30]],
  },
}
export const CANTEENS = {
  [V]: { id: V, name: 'VESIT Canteen', where: 'Ground floor, west wing of the VESIT main block', place: { f: 0, id: 'canteen' }, source: 'Menu boards and the canteen price list, photographed 16 Oct 2026', partial: false },
  [M]: { id: M, name: 'VESIM Canteen', where: 'VESIM building, same campus (Collector Colony)', hours: 'Lunch 12:00–2:30', source: 'Canteen price list shared 16 Oct 2026 and Anuj Caterers boards (readable lines only)', partial: true },
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export function makeMenu() {
  const out = []
  for (const [canteen, cats] of Object.entries(RAW)) for (const [category, items] of Object.entries(cats)) for (const [name, price] of items) out.push({ id: `dish_${canteen.toLowerCase()}_${slug(category)}_${slug(name)}`, canteen, category, name, price, available: true, description: '' })
  return out
}

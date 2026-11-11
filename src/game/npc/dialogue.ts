/** Original Hinglish lines with English glosses. */
export type NPCKind = 'office' | 'student' | 'shopper' | 'elderly' | 'delivery' | 'tourist' | 'family' | 'vendor' | 'police' | 'guard'

export interface Line {
  hi: string
  en: string
}

const L = (hi: string, en: string): Line => ({ hi, en })

const GENERIC = [
  L('Namaste!', 'Hello!'),
  L('Haan bhai, bolo?', 'Yes brother, what’s up?'),
  L('Kya haal hai?', 'How are you doing?'),
  L('Aaj dhoop tez hai yaar.', 'The sun is strong today.'),
  L('CP ka chakkar laga rahe ho?', 'Taking a round of CP?'),
  L('Rajiv Chowk metro se jao, jaldi pahunchoge.', 'Take the metro from Rajiv Chowk, it’s faster.'),
  L('Janpath pe achhi shopping milti hai.', 'Janpath has good street shopping.'),
  L('India Gate shaam ko bahut sundar lagta hai.', 'India Gate looks beautiful in the evening.'),
  L('Chai pi lo, yahan mast banti hai.', 'Have some chai, it’s great here.'),
  L('Traffic dekha? Pura jam hai!', 'Seen the traffic? Total jam!'),
  L('Sorry bhai, thodi jaldi mein hoon.', 'Sorry, I’m in a bit of a hurry.'),
  L('Dilli mein swagat hai!', 'Welcome to Delhi!'),
]
const BY_KIND: Partial<Record<NPCKind, Line[]>> = {
  office: [L('Meeting ke liye late ho raha hoon!', 'I’m getting late for a meeting!'), L('Lunch break mein thoda ghoom raha hoon.', 'Just a walk in my lunch break.')],
  student: [L('Exam aa rahe hain, tension hai.', 'Exams are coming, so stressed.'), L('Canteen ka khana boring hai yaar.', 'Canteen food is so boring.')],
  elderly: [L('Beta, dhyaan se chalna.', 'Walk carefully, child.'), L('Pehle CP aisa nahi tha, sab badal gaya.', 'CP wasn’t like this before, everything’s changed.')],
  delivery: [L('Order deliver karna hai, rasta do!', 'Got an order to deliver, make way!'), L('Ye gali kahan nikalti hai, pata hai?', 'Know where this lane comes out?')],
  tourist: [L('Excuse me, India Gate kis taraf hai?', 'Excuse me, which way is India Gate?'), L('This city is amazing!', 'This city is amazing!')],
  family: [L('Bachchon ko India Gate dikhane laaye hain.', 'Brought the kids to see India Gate.'), L('Ice cream khayenge, chalo!', 'Let’s go get ice cream!')],
  vendor: [L('Garma garam chai, sirf pandrah rupaye!', 'Piping hot chai, just fifteen rupees!'), L('Aao bhaiya, kya chahiye?', 'Come, brother, what do you need?'), L('Sab taaza hai, le lo!', 'Everything’s fresh, take some!')],
  police: [L('Signal dekh ke road cross karo.', 'Check the signal before crossing.'), L('Zebra crossing se jao.', 'Use the zebra crossing.'), L('Helmet pehna karo, bhai.', 'Always wear a helmet, brother.')],
  guard: [L('Andar entry pass ke saath hai, sir.', 'Entry is with a pass only, sir.'), L('Sir, yahan parking mana hai.', 'Sir, no parking here.')],
}
const NIGHT = [L('Raat ho gayi, ghar jaana hai.', 'It’s late, need to get home.'), L('Raat mein India Gate ki lights dekhi?', 'Seen India Gate lit up at night?')]
export const BUMP = [L('Arre bhai, dekh ke!', 'Hey, watch it!'), L('Oye! Dhyaan se!', 'Oi! Careful!'), L('Arre arre, gira doge kya?', 'Whoa, you’ll knock me over!')]

export function lineFor(kind: NPCKind, night: boolean, r: number): Line {
  const pool = [...(BY_KIND[kind] ?? []), ...(BY_KIND[kind] ? BY_KIND[kind]! : []), ...GENERIC, ...(night ? NIGHT : [])]
  return pool[Math.floor(r * pool.length) % pool.length]
}

/** Overheard snippets between NPCs (time/weather aware). */
const CHATTER = [
  L('Kal match dekha? Last over mein kya six maara!', 'Saw the match yesterday? What a six in the last over!'),
  L('Petrol phir mehenga ho gaya yaar.', 'Petrol got pricier again, man.'),
  L('Metro mein aaj bahut bheed thi.', 'The metro was so crowded today.'),
  L('Chalo, ek-ek chai ho jaaye.', 'Come on, let’s have a chai each.'),
  L('Boss ne phir se weekend pe bulaya hai.', 'The boss called us in on the weekend again.'),
  L('Is gali mein naya momos wala aaya hai.', 'A new momos stall has opened on this lane.'),
  L('Shaadi ka season hai, sab kuch book hai.', 'It’s wedding season, everything’s booked.'),
  L('Beta, padhai pe dhyaan do.', 'Child, focus on your studies.'),
  L('Arey, kitne ka liya? Bahut mehenga hai!', 'Hey, how much did you pay? That’s too expensive!'),
  L('Aaj AQI phir kharab hai.', 'The air quality is bad again today.'),
]
const RAIN_CHAT = [L('Baarish ho gayi! Chhata le aate.', 'It’s raining! Should’ve brought an umbrella.'), L('Pakode aur chai ka mausam hai!', 'Perfect weather for pakoras and chai!')]
const NIGHT_CHAT = [L('Chalo, ghar chalte hain, der ho gayi.', 'Let’s head home, it’s late.')]
const VENDOR_CALL = [L('Chai! Garam chai!', 'Tea! Hot tea!'), L('Samose garam, le lo!', 'Hot samosas, get them!'), L('Taaze phal, sasta sasta!', 'Fresh fruit, cheap cheap!'), L('Paan kha lo, bhaiya!', 'Have a paan, brother!')]
export function chatterLine(raining: boolean, night: boolean, r: number): Line {
  const pool = [...CHATTER, ...(raining ? [...RAIN_CHAT, ...RAIN_CHAT, ...RAIN_CHAT] : []), ...(night ? NIGHT_CHAT : [])]
  return pool[Math.floor(r * pool.length) % pool.length]
}
export const vendorCall = (r: number) => VENDOR_CALL[Math.floor(r * VENDOR_CALL.length) % VENDOR_CALL.length]

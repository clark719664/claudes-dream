// The knowledge base. Every entry answers three questions a reminder app normally leaves to you:
// how long the thing lasts, where its date is printed, and why it matters that you know.
//
// `every` = repeats on that interval from the last time you did it.
// `life`  = one-off lifespan counted from the date printed on the thing (or the day you got it).
// `lead`  = days of warning before it comes due, tuned to how long the fix actually takes.
//
// Intervals are typical manufacturer or public-safety guidance, not rules. The label on your
// device and your local regulations always win, and every number here is editable per item.

export const CATEGORIES = [
  { id: 'safety', name: 'Safety', blurb: 'The ones with no warning light. Most of these expire quietly.' },
  { id: 'home', name: 'Home systems', blurb: 'Filters, water, air, and the parts that flood a house when they fail.' },
  { id: 'vehicle', name: 'Vehicle', blurb: 'Rubber and fluid age out on dates, not just on distance.' },
  { id: 'docs', name: 'Documents & renewals', blurb: 'Where being late costs you a trip, a fine, or a re-application.' },
  { id: 'money', name: 'Money & admin', blurb: 'Auto-renewals, cards, and the paperwork nobody re-reads.' },
  { id: 'health', name: 'Health & personal', blurb: 'Routine visits and the small things with a real shelf life.' },
  { id: 'kitchen', name: 'Kitchen & pantry', blurb: 'Quietly stale rather than unsafe — but it shows in the cooking.' },
  { id: 'pets', name: 'Pets', blurb: 'Monthly doses and annual visits, per your vet.' },
  { id: 'digital', name: 'Digital', blurb: 'Backups you have never restored, and renewals that break things.' },
];

export const CATALOG = [
  // ---------------------------------------------------------------- safety
  {
    id: 'smoke-alarm', cat: 'safety', name: 'Smoke alarm', kind: 'expiry', life: { n: 10, unit: 'year' }, lead: 60,
    ask: 'What date is on the back of the alarm?',
    where: 'Take it off the ceiling and look at the back plate — there is a manufacture date stamped near the model number.',
    why: 'The sensor degrades whether or not it ever sees smoke. Manufacturers and fire services put the whole unit at 10 years from manufacture, not from when you installed it. A working beep does not mean a working sensor.',
  },
  {
    id: 'smoke-alarm-test', cat: 'safety', name: 'Test the smoke alarms', kind: 'interval', every: { n: 1, unit: 'month' }, lead: 3,
    ask: 'When did you last press the test button?',
    where: 'The test button on the alarm face.',
    why: 'Thirty seconds, once a month. It is the only way to catch a dead battery or a failed horn before the night you need it.',
  },
  {
    id: 'smoke-battery', cat: 'safety', name: 'Smoke alarm battery', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last change it?',
    where: 'Skip this one if your alarm has a sealed 10-year battery — replace the whole unit instead.',
    why: 'Chirping at 3am is the classic failure mode. Changing it on a date you choose beats changing it at the hour it picks.',
  },
  {
    id: 'co-alarm', cat: 'safety', name: 'Carbon monoxide alarm', kind: 'expiry', life: { n: 7, unit: 'year' }, lead: 60,
    ask: 'What is the end-of-life or manufacture date on the unit?',
    where: 'Printed on the back or side. Many models state an explicit "replace by" date.',
    why: 'CO sensors have a shorter life than smoke sensors — commonly 5 to 10 years depending on the model. Check your label and set the real number; the default here is a middle estimate.',
  },
  {
    id: 'extinguisher', cat: 'safety', name: 'Fire extinguisher', kind: 'expiry', life: { n: 12, unit: 'year' }, lead: 90,
    ask: 'What is the date on the extinguisher label?',
    where: 'On the label or stamped into the metal near the neck. Rechargeable units also carry a service tag.',
    why: 'Disposable units are generally done at about 12 years. Rechargeable ones need professional service roughly every 6 years and a pressure test at 12. Either way the gauge needle should sit in the green — glance at it monthly.',
  },
  {
    id: 'car-seat', cat: 'safety', name: 'Child car seat', kind: 'expiry', life: { n: 7, unit: 'year' }, lead: 90,
    ask: 'What is the manufacture date on the seat?',
    where: 'A sticker on the shell, usually on the side or underside, with a manufacture date and often an explicit expiry.',
    why: 'Plastic and webbing fatigue, and standards move. Makers set 6 to 10 years from manufacture — your seat states which. Also replace it after any moderate crash, whatever the date says.',
  },
  {
    id: 'helmet', cat: 'safety', name: 'Bike or ski helmet', kind: 'expiry', life: { n: 5, unit: 'year' }, lead: 30,
    ask: 'When did you buy it?',
    where: 'Inside the shell, on the certification sticker.',
    why: 'Most manufacturers say five years of normal use. Replace it immediately after any real impact, even if the shell looks fine — the foam crushes once, and it has already done its job.',
  },
  {
    id: 'first-aid', cat: 'safety', name: 'First aid kit check', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last go through it?',
    where: 'Sterile dressings and any medication inside carry their own dates.',
    why: 'Kits are bought once and opened in an emergency. Sterile packs expire, tape dries out, and someone always takes the last plaster.',
  },
  {
    id: 'surge-protector', cat: 'safety', name: 'Surge protector', kind: 'expiry', life: { n: 4, unit: 'year' }, lead: 30,
    ask: 'When did you buy it?',
    where: 'Nowhere — that is the problem. Write the date on the underside in marker when you plug it in.',
    why: 'The components that absorb surges wear out absorbing them. An old strip keeps powering your devices while protecting nothing, and almost none of them tell you.',
  },
  {
    id: 'emergency-water', cat: 'safety', name: 'Emergency water & supplies', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last rotate the kit?',
    where: 'Bottled water and food carry printed dates; batteries have a use-by too.',
    why: 'A kit you never rotate is a kit of expired food and flat batteries. One date a year keeps it real.',
  },

  // ---------------------------------------------------------------- home
  {
    id: 'hvac-filter', cat: 'home', name: 'Furnace / AC filter', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you last change it?',
    where: 'The size is printed on the frame of the one you pull out — photograph it before you bin it.',
    why: 'A thin pleated filter is a 1–3 month part; a thick 100mm media filter runs 6–12 months. A clogged one makes the system work harder for less air, which costs money every month it stays in.',
  },
  {
    id: 'washer-hoses', cat: 'home', name: 'Washing machine hoses', kind: 'expiry', life: { n: 5, unit: 'year' }, lead: 30,
    ask: 'When were the hoses last replaced?',
    where: 'Behind the machine. Braided stainless hoses are the upgrade worth making.',
    why: 'These sit under mains pressure permanently and are a leading cause of domestic water damage. Insurers suggest replacing them around five years — it is a cheap part and a very expensive failure.',
  },
  {
    id: 'fridge-filter', cat: 'home', name: 'Fridge water filter', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 7,
    ask: 'When did you last change it?',
    where: 'Model number is on the filter cartridge itself.',
    why: 'Six months is the usual rating. Past that you are drinking through a saturated cartridge instead of a filter.',
  },
  {
    id: 'pitcher-filter', cat: 'home', name: 'Water filter pitcher', kind: 'interval', every: { n: 2, unit: 'month' }, lead: 5,
    ask: 'When did you last change it?',
    where: 'On the box — usually quoted in litres or gallons as well as weeks.',
    why: 'Rated by volume, roughly two months for one household. The taste goes before the filtering does.',
  },
  {
    id: 'undersink-filter', cat: 'home', name: 'Under-sink or RO water filter', kind: 'interval', every: { n: 9, unit: 'month' }, lead: 14,
    ask: 'When did you last change the cartridges?',
    where: 'Each cartridge carries its own rating; standard housings take generic 10 x 2.5 inch cartridges.',
    why: 'The sediment and carbon stages run 6 to 12 months, and they are what protect the expensive part — the reverse osmosis membrane, which then lasts two to three years instead of one. A neglected pre-filter is how people end up replacing a membrane early.',
  },
  {
    id: 'water-heater-flush', cat: 'home', name: 'Flush the water heater', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 21,
    ask: 'When was it last flushed?',
    where: 'Drain valve at the bottom of the tank.',
    why: 'Sediment settles on the bottom and insulates the burner from the water, so you pay to heat scale. Flushing yearly is the single biggest thing you can do for the tank.',
  },
  {
    id: 'anode-rod', cat: 'home', name: 'Water heater anode rod', kind: 'interval', every: { n: 4, unit: 'year' }, lead: 30,
    ask: 'When was it last checked or changed?',
    where: 'Under a cap on top of the tank, or combined with the hot outlet.',
    why: 'The rod exists to corrode so the tank does not. Once it is gone the tank starts rusting from inside, and a rod costs a fraction of a heater.',
  },
  {
    id: 'dryer-vent', cat: 'home', name: 'Clean the dryer vent', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 21,
    ask: 'When was it last cleaned out?',
    where: 'The full duct run from the machine to the outside vent, not just the lint screen.',
    why: 'Packed lint is both a fire risk and the reason your clothes take two cycles to dry.',
  },
  {
    id: 'hvac-service', cat: 'home', name: 'Heating / cooling service', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 45,
    ask: 'When was it last serviced?',
    where: 'The technician usually leaves a dated sticker on the unit.',
    why: 'Annual service catches the failure before the first cold night, when every engineer in the city is already booked. Gas appliances may also need it to keep a warranty or a landlord certificate valid.',
  },
  {
    id: 'chimney', cat: 'home', name: 'Chimney sweep / inspection', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 45,
    ask: 'When was it last swept?',
    where: 'Your sweep should give you a dated certificate — insurers sometimes ask for it.',
    why: 'Annual inspection is the standard for anything you burn fuel in. Creosote build-up is what turns a chimney into a chimney fire.',
  },
  {
    id: 'sump-pump', cat: 'home', name: 'Test the sump pump', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you last test it?',
    where: 'Pour a bucket of water into the pit and watch it cycle.',
    why: 'A sump pump has one job, on one day, with no notice. Pumps last roughly ten years, and they nearly always fail sitting still rather than running.',
  },
  {
    id: 'septic', cat: 'home', name: 'Septic tank pump-out', kind: 'interval', every: { n: 4, unit: 'year' }, lead: 60,
    ask: 'When was it last pumped?',
    where: 'The contractor leaves a dated receipt — keep it for the property file.',
    why: 'Typical guidance is every three to five years depending on tank size and household. Skipping it damages the drain field, which is the expensive half of the system.',
  },
  {
    id: 'gutters', cat: 'home', name: 'Clear the gutters', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 14,
    ask: 'When did you last clear them?',
    where: 'Downpipe outlets are where the blockage usually is.',
    why: 'Twice a year, after leaf fall and before the wet season. Overflowing gutters work on your walls and foundations quietly for years.',
  },
  {
    id: 'range-filter', cat: 'home', name: 'Extractor hood filter', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 7,
    ask: 'When did you last change or clean it?',
    where: 'Under the hood — metal mesh filters wash, charcoal ones get replaced.',
    why: 'Charcoal filters saturate at around six months. A greased-up mesh moves very little air, which you notice as a kitchen that smells of last night.',
  },
  {
    id: 'dishwasher-filter', cat: 'home', name: 'Clean the dishwasher filter', kind: 'interval', every: { n: 1, unit: 'month' }, lead: 5,
    ask: 'When did you last clean it?',
    where: 'Twist out the cylinder in the floor of the machine.',
    why: 'Most people have never opened it. It is usually the whole explanation for gritty glasses and a smell.',
  },
  {
    id: 'fridge-coils', cat: 'home', name: 'Vacuum the fridge coils', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last do it?',
    where: 'Behind or underneath, behind a snap-off grille.',
    why: 'Dusty coils cannot dump heat, so the compressor runs longer for the same cold. Ten minutes with a vacuum, once a year.',
  },
  {
    id: 'bath-caulk', cat: 'home', name: 'Re-seal bath & shower', kind: 'interval', every: { n: 5, unit: 'year' }, lead: 30,
    ask: 'When was it last re-sealed?',
    where: 'The joint between the bath or tray and the wall.',
    why: 'Sealant shrinks and lifts at the corners, and the water goes into the wall long before you see a stain on it.',
  },

  // ---------------------------------------------------------------- vehicle
  {
    id: 'tires-age', cat: 'vehicle', name: 'Tyre age check', kind: 'expiry', life: { n: 6, unit: 'year' }, lead: 60,
    ask: 'What is the DOT date code on the sidewall?',
    where: 'Find "DOT" on the sidewall and read the last four digits: week, then year. "2319" is the 23rd week of 2019.',
    why: 'Rubber ages out whether you drive or not. Plenty of tyres with legal tread are a decade old — many makers advise replacement at six years and almost all cap it at ten. Spare tyres are the usual offenders.',
  },
  {
    id: 'oil-change', cat: 'vehicle', name: 'Oil change', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 14,
    ask: 'When was the last one?',
    where: 'The garage sticker in the windscreen corner, or the service book.',
    why: 'Distance or time, whichever comes first — and for short-trip driving it is usually time. Your handbook has the real interval for your engine and oil.',
  },
  {
    id: 'car-battery', cat: 'vehicle', name: 'Car battery', kind: 'expiry', life: { n: 4, unit: 'year' }, lead: 30,
    ask: 'When was the battery fitted?',
    where: 'A date sticker or punched tab on the battery case.',
    why: 'Three to five years is normal. They almost always die on the first genuinely cold morning, which is also when you least want to deal with it.',
  },
  {
    id: 'wipers', cat: 'vehicle', name: 'Wiper blades', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When were they last replaced?',
    where: 'Run a finger along the rubber edge — nicks and hard spots mean done.',
    why: 'Six to twelve months. Cheap, two minutes, and the difference between seeing and guessing in heavy rain at night.',
  },
  {
    id: 'cabin-filter', cat: 'vehicle', name: 'Cabin air filter', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When was it last changed?',
    where: 'Usually behind the glovebox — a five-minute job on most cars.',
    why: 'It is the reason the vents smell and the demister is slow. Garages charge a lot for a part you can often fit yourself.',
  },
  {
    id: 'brake-fluid', cat: 'vehicle', name: 'Brake fluid', kind: 'interval', every: { n: 2, unit: 'year' }, lead: 30,
    ask: 'When was it last changed?',
    where: 'In the service record.',
    why: 'Brake fluid absorbs water from the air, which lowers its boiling point. Most makers specify a change every two years regardless of mileage.',
  },
  {
    id: 'coolant', cat: 'vehicle', name: 'Coolant / antifreeze', kind: 'interval', every: { n: 5, unit: 'year' }, lead: 45,
    ask: 'When was it last changed?',
    where: 'Your handbook gives the interval and the exact specification — they are not interchangeable.',
    why: 'The corrosion inhibitors deplete long before the colour changes. Old coolant quietly works on the water pump and radiator.',
  },

  // ---------------------------------------------------------------- docs
  {
    id: 'passport', cat: 'docs', name: 'Passport', kind: 'expiry', life: { n: 10, unit: 'year' }, lead: 270,
    ask: 'When does it expire?',
    where: 'The photo page.',
    why: 'Nine months of warning is deliberate. Many countries refuse entry unless your passport is valid for six months beyond your trip, and renewal can take weeks. The date that matters is not the one in the passport.',
  },
  {
    id: 'child-passport', cat: 'docs', name: "Child's passport", kind: 'expiry', life: { n: 5, unit: 'year' }, lead: 270,
    ask: 'When does it expire?',
    where: 'The photo page.',
    why: 'Children\'s passports usually run five years, not ten, so they lapse between family trips — and they need the same six months of validity at the border.',
  },
  {
    id: 'license', cat: 'docs', name: 'Driving licence', kind: 'expiry', life: { n: 5, unit: 'year' }, lead: 60,
    ask: 'When does it expire?',
    where: 'On the card. Photocard licences often expire years before the entitlement does.',
    why: 'Driving on an expired licence can void your insurance, and the photo renewal is easy to miss because nothing stops working.',
  },
  {
    id: 'registration', cat: 'docs', name: 'Vehicle registration / road tax', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When does the current one run out?',
    where: 'The renewal notice, or your national vehicle service online.',
    why: 'Automated cameras enforce this in many places, so the first thing you hear about it is the fine.',
  },
  {
    id: 'inspection', cat: 'docs', name: 'Vehicle inspection / MOT', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When does the current certificate expire?',
    where: 'The certificate from the test station.',
    why: 'Book with a month to spare so there is time to fix whatever it fails on without the car being off the road.',
  },
  {
    id: 'visa', cat: 'docs', name: 'Visa / residence permit', kind: 'expiry', life: null, lead: 120,
    ask: 'When does it expire?',
    where: 'The permit card or the vignette in your passport.',
    why: 'Applications often have to be filed well before expiry, and a lapse can affect the right to work or to re-enter. Four months of warning is not excessive here.',
  },
  {
    id: 'precheck', cat: 'docs', name: 'Trusted traveller programme', kind: 'expiry', life: { n: 5, unit: 'year' }, lead: 180,
    ask: 'When does your membership expire?',
    where: 'In your programme account, or on the card.',
    why: 'Five-year terms, and renewals can sit in a queue for months. Starting early usually keeps the benefit running while it processes.',
  },
  {
    id: 'pro-license', cat: 'docs', name: 'Professional licence or certification', kind: 'interval', every: { n: 2, unit: 'year' }, lead: 90,
    ask: 'When does the current one expire?',
    where: 'Your certificate or the registry entry.',
    why: 'Renewal often needs training hours completed first, so the real deadline is months before the printed one.',
  },
  {
    id: 'first-aid-cert', cat: 'docs', name: 'First aid / CPR certificate', kind: 'interval', every: { n: 2, unit: 'year' }, lead: 60,
    ask: 'When did you certify?',
    where: 'On the certificate.',
    why: 'Usually valid for two or three years, and it is the kind of thing that lapses right when a job or a volunteering role asks to see it.',
  },

  // ---------------------------------------------------------------- money
  {
    id: 'insurance-home', cat: 'money', name: 'Home or renters insurance', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When does the policy renew?',
    where: 'The schedule on your policy documents.',
    why: 'Auto-renewal quotes are routinely worse than new-customer ones. A month of notice is enough to get two comparisons and either switch or ask them to match.',
  },
  {
    id: 'insurance-car', cat: 'money', name: 'Car insurance', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When does it renew?',
    where: 'Your renewal notice.',
    why: 'Same trap as home cover, and prices move enough year to year that a single phone call often pays for itself.',
  },
  {
    id: 'insurance-travel', cat: 'money', name: 'Travel insurance', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 21,
    ask: 'When does the annual policy end?',
    where: 'Your policy certificate.',
    why: 'Annual multi-trip policies lapse silently, and people discover it at an airport rather than at home.',
  },
  {
    id: 'warranty', cat: 'money', name: 'Appliance or device warranty', kind: 'expiry', life: { n: 2, unit: 'year' }, lead: 45,
    ask: 'When does the warranty end?',
    where: 'The receipt sets the clock. Photograph it now and note where it is saved.',
    why: 'Things fail just after the cover ends far more often than chance suggests. Six weeks of warning is enough to get a borderline fault looked at while it is still free.',
  },
  {
    id: 'card-expiry', cat: 'money', name: 'Card expiry (autopay)', kind: 'expiry', life: { n: 3, unit: 'year' }, lead: 30,
    ask: 'When does the card expire?',
    where: 'On the front of the card.',
    why: 'When a card expires, every subscription paying with it starts failing — sometimes including the ones you would rather not have interrupted, like insurance or a phone line.',
  },
  {
    id: 'lease', cat: 'money', name: 'Lease or tenancy end', kind: 'expiry', life: { n: 1, unit: 'year' }, lead: 90,
    ask: 'When does the term end?',
    where: 'The term clause in your agreement — read the notice period while you are in there.',
    why: 'Notice is commonly due one or two months before the end, so the deadline that matters comes well before the date on the front page. Miss it and you can roll into another term.',
  },
  {
    id: 'subscription-audit', cat: 'money', name: 'Subscription audit', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 5,
    ask: 'When did you last go through them?',
    where: 'Your bank statement, plus the subscriptions list on your phone.',
    why: 'Quarterly is often enough to catch the trial that converted and the service you stopped using two months ago.',
  },
  {
    id: 'free-trial', cat: 'money', name: 'Free trial ending', kind: 'expiry', life: { n: 1, unit: 'month' }, lead: 3,
    ask: 'When does the trial convert to paid?',
    where: 'The signup confirmation email.',
    why: 'This is the whole business model. Three days of warning is enough to decide on purpose instead of by default.',
  },
  {
    id: 'credit-report', cat: 'money', name: 'Check your credit report', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last look at it?',
    where: 'Your national credit reference agencies — most give free access.',
    why: 'It is how you find an account opened in your name, and errors take time to correct, so finding them early matters.',
  },
  {
    id: 'will-review', cat: 'money', name: 'Review will & beneficiaries', kind: 'interval', every: { n: 3, unit: 'year' }, lead: 60,
    ask: 'When did you last review them?',
    where: 'Your will, and the named beneficiaries on pensions and insurance policies.',
    why: 'Beneficiary forms usually override a will, and they are the ones nobody updates after a move, a marriage, or a birth.',
  },

  // ---------------------------------------------------------------- health
  {
    id: 'dentist', cat: 'health', name: 'Dental check-up', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 21,
    ask: 'When was your last appointment?',
    where: 'The card they hand you on the way out.',
    why: 'Six months for most people. The reminder card goes in a drawer, which is how a check-up becomes a filling.',
  },
  {
    id: 'eye-test', cat: 'health', name: 'Eye test', kind: 'interval', every: { n: 2, unit: 'year' }, lead: 30,
    ask: 'When was your last test?',
    where: 'On your prescription slip.',
    why: 'Glasses and contact lens prescriptions expire for ordering purposes, usually after one or two years — so a lapsed test also means you cannot reorder.',
  },
  {
    id: 'lens-case', cat: 'health', name: 'Contact lens case', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you last swap the case?',
    where: 'Solution bottles also have a discard-after-opening window on the label.',
    why: 'Cases build a biofilm that rinsing does not remove, and eye infections from contact lens hygiene are both common and serious.',
  },
  {
    id: 'toothbrush', cat: 'health', name: 'Toothbrush or brush head', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you last change it?',
    where: 'Splayed bristles are the giveaway.',
    why: 'Worn bristles clean noticeably worse, and three months is the standard advice. Sooner after any illness.',
  },
  {
    id: 'sunscreen', cat: 'health', name: 'Sunscreen', kind: 'expiry', life: { n: 3, unit: 'year' }, lead: 30,
    ask: 'What is the expiry date on the bottle?',
    where: 'Stamped on the tube or the base. If there is none, count three years from purchase.',
    why: 'The filters break down, so old sunscreen gives you less protection than the number claims. A bottle that spent a summer in a hot car is done sooner.',
  },
  {
    id: 'eye-makeup', cat: 'health', name: 'Mascara / eye makeup', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you open it?',
    where: 'The open-jar symbol on the packaging gives the months-after-opening figure.',
    why: 'Anything used near the eye is a short-life product once opened — three months is the usual guidance, and it is about infection rather than performance.',
  },
  {
    id: 'medicine-cabinet', cat: 'health', name: 'Medicine cabinet check', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last go through it?',
    where: 'Each box or bottle carries its own date; opened liquids and drops are usually much shorter.',
    why: 'Once a year, clear out what has expired so the painkillers you reach for at 2am are the ones that still work. Take what you remove to a pharmacy for disposal rather than binning or flushing it.',
  },
  {
    id: 'tetanus', cat: 'health', name: 'Tetanus booster', kind: 'interval', every: { n: 10, unit: 'year' }, lead: 90,
    ask: 'When was your last booster?',
    where: 'Your vaccination record or your clinic.',
    why: 'Commonly a ten-year booster for adults, but schedules differ by country and by person — treat this as a prompt to ask your clinician, not a schedule to self-manage.',
  },
  {
    id: 'mouthguard', cat: 'health', name: 'Retainer or night guard', kind: 'expiry', life: { n: 2, unit: 'year' }, lead: 30,
    ask: 'When did you get it?',
    where: 'The case, if you noted it — otherwise your dentist has the date.',
    why: 'They wear thin, crack, and stop holding position. A replacement is far cheaper than the movement it was preventing.',
  },

  // ---------------------------------------------------------------- kitchen
  {
    id: 'spices-ground', cat: 'kitchen', name: 'Ground spices', kind: 'interval', every: { n: 18, unit: 'month' }, lead: 14,
    ask: 'When did you buy or open them?',
    where: 'Write the month on the lid in marker when you open a jar.',
    why: 'Ground spice keeps its aroma for about a year to eighteen months, then it is mostly colour. Rub a pinch in your palm — if it smells of nothing, it does nothing.',
  },
  {
    id: 'spices-whole', cat: 'kitchen', name: 'Whole spices', kind: 'interval', every: { n: 3, unit: 'year' }, lead: 30,
    ask: 'When did you buy them?',
    where: 'The jar, or the lid you dated.',
    why: 'Whole seeds and pods hold their oils far longer than ground — two to four years — which is why buying whole and grinding is the cheaper habit.',
  },
  {
    id: 'baking-powder', cat: 'kitchen', name: 'Baking powder & soda', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you open it?',
    where: 'The tin usually has a best-before, but opening starts a shorter clock.',
    why: 'It loses lift quietly, and you find out when a cake does not rise. Test it: a spoonful in hot water with a splash of vinegar should fizz hard.',
  },
  {
    id: 'flour-wholegrain', cat: 'kitchen', name: 'Wholegrain flour', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you open the bag?',
    where: 'Smell it — rancid wholegrain flour smells like old crayons.',
    why: 'The germ contains oil, so wholemeal and rye go rancid in a few months at room temperature. The fridge or freezer roughly doubles that.',
  },
  {
    id: 'cooking-oil', cat: 'kitchen', name: 'Cooking oil', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 14,
    ask: 'When did you open the bottle?',
    where: 'Nut and seed oils are the most fragile; keep them dark and cool.',
    why: 'Once opened, oil oxidises. Rancid oil tastes faintly of putty and will carry that into everything you cook in it.',
  },
  {
    id: 'yeast', cat: 'kitchen', name: 'Dried yeast', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 14,
    ask: 'When did you open it?',
    where: 'Keep the opened jar in the fridge or freezer.',
    why: 'Open yeast fades, and dead yeast is the usual reason a loaf never rises. Proof a pinch in warm sugary water if you are unsure.',
  },
  {
    id: 'nonstick', cat: 'kitchen', name: 'Nonstick pan', kind: 'expiry', life: { n: 4, unit: 'year' }, lead: 30,
    ask: 'When did you buy it?',
    where: 'Look at the surface — visible scratching or flaking is the real signal.',
    why: 'The coating is the whole product, and it wears with every use. Three to five years of regular cooking is typical; once it is scratched through, replace it.',
  },
  {
    id: 'sponge', cat: 'kitchen', name: 'Kitchen sponge', kind: 'interval', every: { n: 2, unit: 'week' }, lead: 2,
    ask: 'When did you last swap it?',
    where: 'If it smells, it is already overdue.',
    why: 'A damp sponge is the most heavily colonised object in most kitchens. Two weeks is generous, and a washable cloth you can boil is a better answer.',
  },
  {
    id: 'baby-formula', cat: 'kitchen', name: 'Opened formula tin', kind: 'interval', every: { n: 1, unit: 'month' }, lead: 5,
    ask: 'When did you open the tin?',
    where: 'The tin states a use-within period after opening — follow it over this default.',
    why: 'Powder has a short window once opened, and prepared feeds are far shorter still. This is one to follow the label on exactly.',
  },

  // ---------------------------------------------------------------- pets
  {
    id: 'flea-tick', cat: 'pets', name: 'Flea & tick treatment', kind: 'interval', every: { n: 1, unit: 'month' }, lead: 3,
    ask: 'When was the last dose?',
    where: 'The pack states the interval — some are monthly, some three-monthly.',
    why: 'Protection lapses on a schedule, and one missed month is usually how an infestation starts in the house rather than on the animal.',
  },
  {
    id: 'heartworm', cat: 'pets', name: 'Parasite / heartworm dose', kind: 'interval', every: { n: 1, unit: 'month' }, lead: 3,
    ask: 'When was the last dose?',
    where: 'Your vet sets the schedule for where you live.',
    why: 'These are prevention, not treatment, so the gaps are what count.',
  },
  {
    id: 'vet-checkup', cat: 'pets', name: 'Vet check-up & boosters', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When was the last visit?',
    where: 'The vaccination card, which also lists what is due when.',
    why: 'Boosters lapsing can also mean a boarding kennel or a pet insurer turns you away, which you find out the week you travel.',
  },
  {
    id: 'microchip', cat: 'pets', name: 'Microchip details', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last confirm the registry has your current details?',
    where: 'The registry website, using the chip number on your paperwork.',
    why: 'A chip pointing at an old phone number is a chip that does nothing. It is a two-minute check and it is the only reason the chip exists.',
  },

  // ---------------------------------------------------------------- digital
  {
    id: 'backup-test', cat: 'digital', name: 'Test a backup restore', kind: 'interval', every: { n: 6, unit: 'month' }, lead: 14,
    ask: 'When did you last actually restore a file from it?',
    where: 'Pick one real file and bring it back from the backup, not from the cloud folder it also lives in.',
    why: 'An untested backup is a belief, not a backup. Silent failures are the norm — full disks, expired credentials, a sync that stopped months ago.',
  },
  {
    id: 'recovery-codes', cat: 'digital', name: 'Two-factor recovery codes', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 14,
    ask: 'When did you last check you still have them?',
    where: 'Wherever you saved them — and make sure it is not only on the phone that is the second factor.',
    why: 'The day you lose your phone is the day you need these, and it is also the day you cannot get into the account holding them.',
  },
  {
    id: 'domain', cat: 'digital', name: 'Domain name renewal', kind: 'interval', every: { n: 1, unit: 'year' }, lead: 30,
    ask: 'When does it expire?',
    where: 'Your registrar account. Check the contact email on it is one you still read.',
    why: 'An expired domain takes your email down with the website, and desirable names get picked up fast once they lapse.',
  },
  {
    id: 'phone-backup', cat: 'digital', name: 'Photos & phone backup check', kind: 'interval', every: { n: 3, unit: 'month' }, lead: 7,
    ask: 'When did you last confirm it ran?',
    where: 'The backup screen in your phone settings shows the last successful date.',
    why: 'Phone backups stop for dull reasons — storage full, a new password, a setting that reset — and the photos are usually the part nobody has a second copy of.',
  },
];

export const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogEntry(id) {
  return BY_ID.get(id) || null;
}

export function searchCatalog(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return CATALOG;
  return CATALOG.filter((c) =>
    (c.name + ' ' + c.cat + ' ' + (c.why || '') + ' ' + (c.where || '')).toLowerCase().includes(needle)
  );
}

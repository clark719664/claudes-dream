// Consumable cross-reference: which replacement part a thing takes, and how often.
//
// Deliberately NOT a UPC database. Nobody can ship a complete offline barcode-to-product
// table, and a wrong part number is worse than none — someone buys the wrong filter. So this
// holds only widely published, stable cross-references, every record says where to confirm
// the number on your own unit, and no UPC is guessed. A scanned barcode the app has not been
// taught is reported honestly as unknown rather than matched to something plausible.
//
// The universal rule, which is why `where` matters more than any table: the old part tells
// you the new part. Almost every consumable has its own number printed on it.

export const PART_GROUPS = [
  { id: 'fridge', name: 'Refrigerator' },
  { id: 'water', name: 'Drinking water' },
  { id: 'air', name: 'Air & heating' },
  { id: 'clean', name: 'Cleaning' },
  { id: 'personal', name: 'Personal care' },
  { id: 'vehicle', name: 'Vehicle' },
  { id: 'plumbing', name: 'Plumbing' },
  { id: 'alarm', name: 'Alarms' },
  { id: 'office', name: 'Office' },
];

/**
 * every  — how often this consumable is replaced
 * parts  — order numbers, OEM first; matched case- and punctuation-insensitively
 * fits   — model prefixes of the appliances that take it, for a nameplate lookup
 * where  — how to confirm it against your own unit, which always beats this table
 */
export const PARTS = [
  // ---------------------------------------------------------------- fridge water
  {
    id: 'ps3', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Frigidaire', names: ['PureSource 3'], parts: ['WF3CB', 'PS-RF200', 'PS2364646'],
    fits: ['FFSS', 'FGHS', 'FPHB', 'LFSS', 'FFHS'], every: { n: 6, unit: 'month' },
    where: 'Pull the old cartridge — its number is printed on the body.',
    note: 'Twist-out cartridge, usually bottom-right of the fresh-food compartment.',
  },
  {
    id: 'ultrawf', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Frigidaire', names: ['PureSource Ultra II', 'PureSource Ultra'],
    parts: ['ULTRAWF', 'EPTWFU01', 'PS2364646'], fits: ['FGHB', 'FPBC', 'LGHB', 'FGSS'],
    every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
    note: 'EPTWFU01 is the newer push-in version of the same filter; they are not interchangeable, so match the shape.',
  },
  {
    id: 'ps2', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Frigidaire', names: ['PureSource 2'], parts: ['WF2CB', 'WFCB', 'NGFC2000'],
    fits: [], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'edr1', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Whirlpool, Maytag, KitchenAid', names: ['EveryDrop Filter 1'],
    parts: ['EDR1RXD1', 'W10295370A', 'W10295370', 'P4RFWB'],
    fits: ['WRS', 'WRX', 'MSS', 'KRS'], every: { n: 6, unit: 'month' },
    where: 'EveryDrop filters are numbered 1 to 6 and the number is printed on the old cartridge. Read it rather than guessing from the fridge model.',
  },
  {
    id: 'edr2', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Whirlpool, Maytag, KitchenAid', names: ['EveryDrop Filter 2'],
    parts: ['EDR2RXD1', 'W10413645A', 'W10413645'], fits: ['WRF', 'WRB', 'MFI'],
    every: { n: 6, unit: 'month' },
    where: 'The number 2 is printed on the old cartridge.',
  },
  {
    id: 'edr3', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Whirlpool, Maytag, KitchenAid', names: ['EveryDrop Filter 3'],
    parts: ['EDR3RXD1', '4396841', '4396710', 'T2WG2L'], fits: ['ED5', 'GS6', 'GD5'],
    every: { n: 6, unit: 'month' },
    where: 'The number 3 is printed on the old cartridge.',
  },
  {
    id: 'samsung-cin', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Samsung', names: ['HAF-CIN', 'HAF-CIN/EXP'], parts: ['DA29-00020B', 'DA29-00020A', 'HAFCIN'],
    fits: ['RF', 'RS', 'RH'], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge, inside the fridge or behind the base grille.',
  },
  {
    id: 'samsung-cu1s', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Samsung', names: ['HAF-CU1S'], parts: ['DA29-00003G', 'DA29-00003B', 'HAFCU1S'],
    fits: [], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'lg-lt1000p', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'LG', names: ['LT1000P'], parts: ['LT1000P', 'ADQ74793501', 'ADQ747935', 'MDJ64844601'],
    fits: ['LFXS', 'LMXS', 'LRFVS', 'LRMVS'], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge, top-right inside the fridge.',
  },
  {
    id: 'lg-lt700p', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'LG', names: ['LT700P'], parts: ['LT700P', 'ADQ36006101', 'ADQ36006102'],
    fits: ['LFX', 'LMX', 'LSXS'], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'ge-mwf', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'GE', names: ['SmartWater MWF'], parts: ['MWF', 'MWFP', 'MWFA', 'GWF', 'MWFINT'],
    fits: ['GSH', 'GSS', 'PSS'], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'ge-rpwfe', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'GE', names: ['RPWFE'], parts: ['RPWFE', 'RPWF'], fits: ['GFE', 'GNE', 'PFE', 'PYE'],
    every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
    note: 'RPWFE carries an RFID chip and RPWF does not — a fridge expecting the chipped one will not recognise the other.',
  },
  {
    id: 'ge-xwf', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'GE', names: ['XWF'], parts: ['XWF', 'XWFE'], fits: ['GBE', 'GDE', 'GFD', 'GSS25'],
    every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'bosch-uc', group: 'fridge', catalogId: 'fridge-filter', what: 'Refrigerator water filter',
    brand: 'Bosch', names: ['UltraClarity'], parts: ['11032518', '11028820', '644845', 'BORPLFTR50'],
    fits: ['B36', 'B26', 'KAD'], every: { n: 6, unit: 'month' },
    where: 'Printed on the old cartridge.',
  },
  {
    id: 'paultra', group: 'fridge', catalogId: 'fridge-coils', what: 'Refrigerator air filter',
    brand: 'Frigidaire', names: ['PureAir Ultra', 'PureAir Ultra II'],
    parts: ['PAULTRA', 'PAULTRA2', '242047805', '5303918825'], fits: ['FGHB', 'FPBC', 'FFSS'],
    every: { n: 6, unit: 'month' },
    where: 'A small cassette clipped to the rear wall inside the fridge.',
    note: 'Separate from the water filter, and the one nobody knows exists.',
  },
  {
    id: 'air1', group: 'fridge', catalogId: 'fridge-coils', what: 'Refrigerator air filter',
    brand: 'Whirlpool', names: ['FreshFlow AIR1'], parts: ['W10311524', 'AIR1', 'W10335147'],
    fits: ['WRF', 'WRX', 'KRF'], every: { n: 6, unit: 'month' },
    where: 'Inside the fridge, usually in the upper-left corner behind a small door.',
  },

  // ---------------------------------------------------------------- drinking water
  {
    id: 'brita-standard', group: 'water', catalogId: 'pitcher-filter', what: 'Water pitcher filter',
    brand: 'Brita', names: ['Standard', 'White filter'], parts: ['OB03', '35557', 'SAFF-100'],
    fits: [], every: { n: 2, unit: 'month' },
    where: 'The white round cartridge. Rated about 40 gallons or 150 litres.',
  },
  {
    id: 'brita-elite', group: 'water', catalogId: 'pitcher-filter', what: 'Water pitcher filter',
    brand: 'Brita', names: ['Elite', 'Longlast', 'Blue filter'], parts: ['OB06', 'FR-200', '36311'],
    fits: [], every: { n: 6, unit: 'month' },
    where: 'The blue cartridge. Rated about 120 gallons or 450 litres — three times the white one.',
  },
  {
    id: 'pur-plus', group: 'water', catalogId: 'pitcher-filter', what: 'Water pitcher filter',
    brand: 'PUR', names: ['PUR Plus', 'PUR Basic'], parts: ['PPF900Z', 'PPF951K', 'CRF-950Z'],
    fits: [], every: { n: 2, unit: 'month' },
    where: 'Printed on the cartridge collar. Rated about 40 gallons.',
  },
  {
    id: 'zerowater', group: 'water', catalogId: 'pitcher-filter', what: 'Water pitcher filter',
    brand: 'ZeroWater', names: ['ZeroWater filter'], parts: ['ZR-001', 'ZR-017', 'ZR-006'],
    fits: [], every: { n: 2, unit: 'month' },
    where: 'Replace by the meter, not the calendar: change it when the included TDS meter reads 006 ppm.',
  },
  {
    id: 'ro-set', group: 'water', catalogId: 'undersink-filter', what: 'Reverse osmosis filters',
    brand: 'Generic', names: ['RO pre-filters', 'RO membrane'],
    parts: ['10x2.5', 'FILTER-SET', 'TFC-1812', 'TFC-2012'], fits: [], every: { n: 9, unit: 'month' },
    where: 'Standard 10-inch housings take generic 10 x 2.5 inch cartridges; the membrane is a separate longer-lived part.',
    note: 'Sediment and carbon stages run 6 to 12 months; the membrane 2 to 3 years; the polishing carbon annually.',
  },
  {
    id: 'shower-filter', group: 'water', catalogId: 'undersink-filter', what: 'Shower filter cartridge',
    brand: 'Generic', names: ['Shower filter'], parts: [], fits: [], every: { n: 6, unit: 'month' },
    where: 'Unscrew the housing; the cartridge model is printed on its end cap.',
  },

  // ---------------------------------------------------------------- air & heating
  {
    id: 'hvac-1in', group: 'air', catalogId: 'hvac-filter', what: 'Furnace / AC filter (1 inch)',
    brand: 'Any', names: ['Pleated filter'], parts: ['16x25x1', '20x25x1', '16x20x1', '20x20x1', '14x25x1', '14x20x1', '12x24x1'],
    fits: [], every: { n: 3, unit: 'month' },
    where: 'The size is printed on the cardboard frame of the one you pull out. Photograph it before you bin it — the nominal size on the frame is what you order, not the tape-measure size.',
    note: 'A thin pleated filter is a 1 to 3 month part. MERV 8 to 11 suits most homes; higher than your system is rated for restricts airflow.',
  },
  {
    id: 'honeywell-media', group: 'air', catalogId: 'hvac-filter', what: 'Furnace media filter (4-5 inch)',
    brand: 'Honeywell', names: ['Media air cleaner filter'],
    parts: ['FC100A1037', 'FC100A1029', 'FC100A1003', 'FC100A1025', 'FC40R1003'],
    fits: ['F100', 'F200', 'FC100'], every: { n: 9, unit: 'month' },
    where: 'The filter number is printed inside the cabinet door. FC100A1037 is 20x25x4, FC100A1029 is 16x25x4, FC100A1003 is 16x20x4.',
    note: 'Thick media filters run 6 to 12 months rather than 3.',
  },
  {
    id: 'aprilaire-media', group: 'air', catalogId: 'hvac-filter', what: 'Furnace media filter',
    brand: 'Aprilaire', names: ['Aprilaire media filter'], parts: ['201', '210', '213', '413', '401', '501'],
    fits: ['1210', '2210', '3210', '4200', '2120', '2200'], every: { n: 9, unit: 'month' },
    where: 'The filter number is on a label inside the cabinet door — match it exactly, because the cabinet sizes are not interchangeable.',
  },
  {
    id: 'aprilaire-pad-35', group: 'air', catalogId: 'hvac-service', what: 'Humidifier water panel',
    brand: 'Aprilaire', names: ['Water Panel 35'], parts: ['35', '#35'],
    fits: ['350', '360', '560', '568', '600', '700', '760', '768'], every: { n: 1, unit: 'year' },
    where: 'The pad number is printed on the old panel and on the humidifier label.',
    note: 'Replace at the start of each heating season. A scaled pad evaporates almost nothing.',
  },
  {
    id: 'aprilaire-pad-45', group: 'air', catalogId: 'hvac-service', what: 'Humidifier water panel',
    brand: 'Aprilaire', names: ['Water Panel 45'], parts: ['45', '#45'],
    fits: ['400', '400A', '400M', '440', '445', '448'], every: { n: 1, unit: 'year' },
    where: 'Printed on the old panel.',
  },
  {
    id: 'aprilaire-pad-10', group: 'air', catalogId: 'hvac-service', what: 'Humidifier water panel',
    brand: 'Aprilaire', names: ['Water Panel 10'], parts: ['10', '#10'],
    fits: ['110', '220', '500', '500A', '500M', '550', '558'], every: { n: 1, unit: 'year' },
    where: 'Printed on the old panel.',
  },
  {
    id: 'generalaire-pad', group: 'air', catalogId: 'hvac-service', what: 'Humidifier pad',
    brand: 'GeneralAire', names: ['GeneralAire pad'], parts: ['1099', 'GFI7', '7', '990-13'],
    fits: ['1042', '1137', '900', '1000'], every: { n: 1, unit: 'year' },
    where: 'Printed on the old pad.',
  },
  {
    id: 'honeywell-hepa', group: 'air', catalogId: null, what: 'Air purifier HEPA filter',
    brand: 'Honeywell', names: ['True HEPA filter'], parts: ['HRF-R1', 'HRF-R2', 'HRF-R3', 'HRF-AP1', 'HRF-APP1'],
    fits: ['HPA100', 'HPA200', 'HPA300', 'HPA5300', 'HPA8350'], every: { n: 1, unit: 'year' },
    where: 'The letter R filters are the HEPA rounds; HRF-AP1 is the black pre-filter. The count you need is printed inside the door.',
    note: 'HEPA rounds run about a year; the pre-filter about three months.',
  },
  {
    id: 'levoit', group: 'air', catalogId: null, what: 'Air purifier filter',
    brand: 'Levoit', names: ['Levoit replacement filter'],
    parts: ['CORE300-RF', 'CORE400S-RF', 'CORE200S-RF', 'LV-H132-RF', 'CORE600S-RF'],
    fits: ['CORE300', 'CORE400S', 'CORE200S', 'LV-H132', 'CORE600S'], every: { n: 7, unit: 'month' },
    where: 'The filter code is printed on the filter itself and matches the unit model.',
  },
  {
    id: 'coway', group: 'air', catalogId: null, what: 'Air purifier filter set',
    brand: 'Coway', names: ['Airmega filter set'], parts: ['3304899', '3304900'],
    fits: ['AP-1512HH', 'AP-1512', '200M', '250'], every: { n: 1, unit: 'year' },
    where: 'Model is on the back of the unit.',
    note: 'The carbon pre-filter is washable and the HEPA is not — the HEPA is the annual part.',
  },
  {
    id: 'winix', group: 'air', catalogId: null, what: 'Air purifier filter',
    brand: 'Winix', names: ['Winix filter'], parts: ['115115', '116130', '1712-0096-00'],
    fits: ['5300', '5500', '6300', 'C535', 'P300', 'C545'], every: { n: 1, unit: 'year' },
    where: 'Model is on the back; 115115 is the common "Filter A" set.',
  },
  {
    id: 'range-charcoal', group: 'air', catalogId: 'range-filter', what: 'Extractor hood charcoal filter',
    brand: 'Broan, Whirlpool, GE', names: ['Recirculating charcoal filter'],
    parts: ['BPPF30', 'BPSF30', 'W10272068', '883149', 'JXCF27', 'WB02X10943'],
    fits: [], every: { n: 6, unit: 'month' },
    where: 'Only ductless hoods have one. Look under the hood behind the metal mesh.',
    note: 'The metal mesh washes in the dishwasher; the charcoal pad does not and is the part that gets replaced.',
  },

  // ---------------------------------------------------------------- cleaning
  {
    id: 'shark-nav', group: 'clean', catalogId: null, what: 'Vacuum filter set',
    brand: 'Shark', names: ['Navigator filter set'], parts: ['XFF350', 'XHF350', 'XFF500', 'XHF680'],
    fits: ['NV350', 'NV351', 'NV352', 'NV356', 'NV360', 'NV370', 'NV391', 'NV392'],
    every: { n: 3, unit: 'month' },
    where: 'Model number is on a label underneath the vacuum.',
    note: 'The foam and felt pair washes and air-dries; the HEPA behind the dust cup is the one to replace.',
  },
  {
    id: 'miele-fjm', group: 'clean', catalogId: null, what: 'Vacuum dust bags',
    brand: 'Miele', names: ['AirClean FJM'], parts: ['FJM', '9917710'],
    fits: ['C1', 'C2', 'S241', 'S256', 'S290', 'S500'], every: { n: 3, unit: 'month' },
    where: 'The bag letter is printed on the collar of the bag already fitted, and on the inside of the lid.',
    note: 'Miele bag types are not interchangeable: FJM for compact canisters, GN for full-size, KK for some uprights.',
  },
  {
    id: 'miele-gn', group: 'clean', catalogId: null, what: 'Vacuum dust bags',
    brand: 'Miele', names: ['AirClean GN'], parts: ['GN', '10123210'],
    fits: ['C3', 'S400', 'S600', 'S700', 'S800', 'S2', 'S5', 'S8'], every: { n: 3, unit: 'month' },
    where: 'Printed on the collar of the fitted bag.',
  },
  {
    id: 'roomba', group: 'clean', catalogId: null, what: 'Robot vacuum filter & brushes',
    brand: 'iRobot', names: ['Roomba filter'], parts: ['4632772', '4655985', '4639164'],
    fits: ['E5', 'E6', 'I3', 'I4', 'I6', 'I7', 'J7', 'S9'], every: { n: 2, unit: 'month' },
    where: 'Model is printed under the dust bin.',
    note: 'Filter every couple of months, brushes every 6 to 12, and the side brush is a separate part.',
  },
  {
    id: 'washer-hose-part', group: 'plumbing', catalogId: 'washer-hoses', what: 'Washing machine supply hoses',
    brand: 'Generic', names: ['Braided inlet hose'], parts: ['3/4 FHT', '4FT', '5FT', '6FT'],
    fits: [], every: { n: 5, unit: 'year' },
    where: 'Both ends are 3/4 inch female hose thread on almost every machine; you only need the length.',
    note: 'Buy stainless braided rather than rubber, and fit them in pairs. This is a cheap part whose failure floods a house.',
  },
  {
    id: 'anode', group: 'plumbing', catalogId: 'anode-rod', what: 'Water heater anode rod',
    brand: 'Generic', names: ['Sacrificial anode'], parts: ['3/4 NPT', 'MAGNESIUM', 'ALUMINIUM', 'SEGMENTED'],
    fits: [], every: { n: 4, unit: 'year' },
    where: 'Under a plastic cap on top of the tank, or combined with the hot water outlet on some models.',
    note: 'A segmented flexible rod fits where there is no headroom to pull a straight one. Magnesium protects better; aluminium lasts longer in hard water.',
  },

  // ---------------------------------------------------------------- personal care
  {
    id: 'oralb', group: 'personal', catalogId: 'toothbrush', what: 'Electric toothbrush head',
    brand: 'Oral-B', names: ['Oral-B brush head'], parts: ['EB20', 'EB50', 'EB60', 'EB18', 'EB30', 'EB25'],
    fits: [], every: { n: 3, unit: 'month' },
    where: 'The code is printed on the head or its packet. EB20 is Precision Clean, EB50 CrossAction, EB60 Sensitive, EB18 3D White.',
    note: 'All Oral-B round heads fit all Oral-B handles except the Pulsonic and iO ranges.',
  },
  {
    id: 'sonicare', group: 'personal', catalogId: 'toothbrush', what: 'Electric toothbrush head',
    brand: 'Philips Sonicare', names: ['Sonicare brush head'],
    parts: ['HX6064', 'HX9044', 'HX6062', 'HX9024', 'HX6074', 'HX9054'], fits: [],
    every: { n: 3, unit: 'month' },
    where: 'Printed on the packet. HX6064 is C2 Optimal Plaque Control, HX9044 is G3 Gum Care, HX6062 is ProResults.',
    note: 'Snap-on heads fit all recent Sonicare handles; the older screw-on Essence range is different.',
  },

  // ---------------------------------------------------------------- vehicle
  {
    id: 'car-battery-group', group: 'vehicle', catalogId: 'car-battery', what: 'Car battery',
    brand: 'Any', names: ['Battery group size'],
    parts: ['24F', '25', '34', '35', '47', 'H5', '48', 'H6', '49', 'H8', '51R', '65', '94R', 'H7'],
    fits: [], every: { n: 4, unit: 'year' },
    where: 'The group size is printed on the label of the battery already in the car. That number, not the car model, is what you order.',
    note: 'Group size fixes the case dimensions and terminal positions. Note the cold cranking amps too and do not go below the original.',
  },
  {
    id: 'wiper-size', group: 'vehicle', catalogId: 'wipers', what: 'Wiper blades',
    brand: 'Any', names: ['Blade length'], parts: [], fits: [], every: { n: 1, unit: 'year' },
    where: 'Lay the old blade against a tape measure. Driver and passenger sides are usually different lengths, and the rear is different again.',
    note: 'The attachment clip matters as much as the length — take a photo of how the old one clips on before you pull it off.',
  },
  {
    id: 'cabin-filter-part', group: 'vehicle', catalogId: 'cabin-filter', what: 'Cabin air filter',
    brand: 'Any', names: ['Pollen filter'], parts: ['CF10285', 'CF10134', 'CU2939', 'CUK2939'],
    fits: [], every: { n: 1, unit: 'year' },
    where: 'The part number is printed on the frame of the filter you take out. Those listed here are common cross-reference numbers, not a match for your car.',
    note: 'Usually behind the glovebox and a five-minute job. Fit it with the airflow arrow pointing the way the old one did.',
  },

  // ---------------------------------------------------------------- alarms
  {
    id: 'alarm-battery', group: 'alarm', catalogId: 'smoke-battery', what: 'Smoke alarm battery',
    brand: 'Any', names: ['Alarm battery'], parts: ['9V', 'AA', 'CR123A', 'CR2450'],
    fits: [], every: { n: 1, unit: 'year' },
    where: 'Open the battery door — the type is moulded inside, and often printed beside it.',
    note: 'A sealed 10-year lithium alarm has no replaceable battery: when it chirps at end of life, the whole unit is what gets replaced.',
  },
  {
    id: 'sealed-alarm', group: 'alarm', catalogId: 'smoke-alarm', what: 'Sealed 10-year smoke alarm',
    brand: 'Kidde, First Alert', names: ['10-year sealed alarm'],
    parts: ['I9010', 'P3010', 'SA511', 'SA340', '0916E'], fits: [], every: { n: 10, unit: 'year' },
    where: 'The model and a manufacture date are on the back plate.',
    note: 'Nothing to change but the unit itself, on the tenth year from manufacture.',
  },
  {
    id: 'co-alarm-part', group: 'alarm', catalogId: 'co-alarm', what: 'Carbon monoxide alarm',
    brand: 'Kidde, First Alert', names: ['CO alarm'],
    parts: ['KN-COPP-3', 'KN-COEG-3', 'CO400', 'CO605', '7DCO'], fits: [],
    every: { n: 7, unit: 'year' },
    where: 'Model and an end-of-life or manufacture date are printed on the back.',
    note: 'CO sensor life is model-specific — commonly 5 to 10 years. Set the figure your own label states rather than this default.',
  },

  // ---------------------------------------------------------------- office
  {
    id: 'hp-ink', group: 'office', catalogId: null, what: 'Printer ink',
    brand: 'HP', names: ['HP cartridge'], parts: ['63', '63XL', '64', '64XL', '65', '65XL', '67', '67XL', '910', '910XL', '962'],
    fits: [], every: { n: 6, unit: 'month' },
    where: 'The number is printed on the cartridge and on a sticker inside the printer lid.',
  },
  {
    id: 'brother-drum', group: 'office', catalogId: null, what: 'Laser toner & drum',
    brand: 'Brother', names: ['Brother toner', 'Brother drum'],
    parts: ['TN760', 'TN730', 'DR730', 'TN830', 'DR830', 'TN660', 'DR630'], fits: [],
    every: { n: 1, unit: 'year' },
    where: 'Printed on the cartridge. The toner and the drum are two separate parts.',
    note: 'The drum is the one people forget — it lasts several toners and then streaks every page until replaced.',
  },
  {
    id: 'canon-ink', group: 'office', catalogId: null, what: 'Printer ink',
    brand: 'Canon', names: ['Canon cartridge'],
    parts: ['PG-243', 'CL-244', 'PG-245XL', 'CL-246XL', 'PGI-280', 'CLI-281'], fits: [],
    every: { n: 6, unit: 'month' },
    where: 'Printed on the cartridge.',
  },
];

// ---------------------------------------------------------------- lookup

/** Part numbers are written with and without dashes and spaces; compare them stripped. */
export function normalizePart(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const INDEX = new Map();
for (const rec of PARTS) {
  for (const key of [...rec.parts, ...rec.names]) {
    const norm = normalizePart(key);
    if (norm.length < 2) continue;
    if (!INDEX.has(norm)) INDEX.set(norm, []);
    INDEX.get(norm).push(rec);
  }
}

export function partById(id) {
  return PARTS.find((p) => p.id === id) || null;
}

/**
 * Find records by a part number read off a label. Exact normalized matches first, then
 * records whose number is contained in the text — a sticker often reads "FILTER WF3CB".
 */
export function findByPart(text) {
  const norm = normalizePart(text);
  if (norm.length < 2) return [];
  const exact = INDEX.get(norm);
  if (exact) return [...new Set(exact)];
  const hits = new Set();
  for (const [key, recs] of INDEX) {
    if (key.length >= 4 && (norm.includes(key) || key.includes(norm))) for (const r of recs) hits.add(r);
  }
  return [...hits];
}

/** Find what an appliance takes, from the model number on its nameplate. */
export function findByModel(model) {
  const norm = normalizePart(model);
  if (norm.length < 3) return [];
  return PARTS.filter((rec) => rec.fits.some((prefix) => norm.startsWith(normalizePart(prefix))));
}

export function searchParts(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return PARTS;
  const norm = normalizePart(q);
  return PARTS.filter(
    (rec) =>
      `${rec.what} ${rec.brand} ${rec.names.join(' ')}`.toLowerCase().includes(q) ||
      (norm.length >= 2 && [...rec.parts, ...rec.names].some((p) => normalizePart(p).includes(norm)))
  );
}

/** The one-line answer to "what do I buy again?". */
export function orderLine(rec) {
  const first = rec.parts[0] || rec.names[0] || rec.what;
  const alternates = rec.parts.slice(1, 4);
  return alternates.length ? `${first} (also sold as ${alternates.join(', ')})` : first;
}

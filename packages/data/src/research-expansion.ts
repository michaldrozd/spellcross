import type { ResearchTopic } from './index.js';

export const starterUnitResearch: ResearchTopic[] = [
  {
    id: 'ranger-pathfinder-suite',
    name: 'Ranger Pathfinder Suite',
    description: 'Compact sensors and navigation aids prepare ranger teams for independent scouting.',
    cost: 20,
    unlocks: ['rangers'],
    requires: ['optics-i']
  },
  {
    id: 'gepard-tracking-grid',
    name: 'Gepard Tracking Grid',
    description: 'A stabilized tracking loop lets mobile flak crews engage fast aerial threats.',
    cost: 25,
    unlocks: ['gepard-aa'],
    requires: ['optics-i']
  },
  {
    id: 'vanguard-scout-chassis',
    name: 'Vanguard Scout Chassis',
    description: 'Lightweight armor and long-range radios turn utility vehicles into forward scouts.',
    cost: 20,
    unlocks: ['humvee-scout'],
    requires: ['optics-i']
  },
  {
    id: 'thermal-sniper-cell',
    name: 'Thermal Sniper Cell',
    description: 'Matched thermal sights and spotting drills support precision teams in broken terrain.',
    cost: 35,
    unlocks: ['sniper-team'],
    requires: ['optics-ii']
  },
  {
    id: 'rotor-strike-avionics',
    name: 'Rotor Strike Avionics',
    description: 'Hardened flight computers coordinate low-altitude attack runs near the rift front.',
    cost: 40,
    unlocks: ['attack-helo'],
    requires: ['thermal-sniper-cell']
  },
  {
    id: 'silent-entry-kit',
    name: 'Silent Entry Kit',
    description: 'Suppressed weapons and portable breach tools equip covert assault detachments.',
    cost: 45,
    unlocks: ['commando-team'],
    requires: ['rotor-strike-avionics']
  },
  {
    id: 'psi-resonance-screen',
    name: 'Psi Resonance Screen',
    description: 'Field resonators shield specialist operators from hostile psychic interference.',
    cost: 50,
    unlocks: ['psi-corps'],
    requires: ['silent-entry-kit']
  },
  {
    id: 'tam-rapid-armor',
    name: 'TAM Rapid Armor',
    description: 'Modular protection preserves the speed of a light armored breakthrough force.',
    cost: 30,
    unlocks: ['light-tank'],
    requires: ['armor-upfit']
  },
  {
    id: 'marder-fireteam-link',
    name: 'Marder Fireteam Link',
    description: 'Vehicle and dismount radios share targets without slowing the advance.',
    cost: 35,
    unlocks: ['bradley-ifv'],
    requires: ['tam-rapid-armor']
  },
  {
    id: 'leopard-reactive-control',
    name: 'Leopard Reactive Control',
    description: 'Predictive stabilization and layered defenses complete the heavy tank package.',
    cost: 45,
    unlocks: ['leopard-2'],
    requires: ['marder-fireteam-link']
  },
  {
    id: 'avenger-threat-library',
    name: 'Avenger Threat Library',
    description: 'Updated signatures help short-range missile teams distinguish rift flyers at speed.',
    cost: 35,
    unlocks: ['avenger-aa'],
    requires: ['armor-upfit']
  },
  {
    id: 'line-infantry-modernization',
    name: 'Line Infantry Modernization',
    description: 'Revised field kits give rifle sections a dependable common fighting standard.',
    cost: 20,
    unlocks: ['light-infantry'],
    requires: ['esprit-de-corps']
  },
  {
    id: 'mortar-plotting-cell',
    name: 'Mortar Plotting Cell',
    description: 'Portable plotting boards shorten the call-for-fire cycle for infantry mortars.',
    cost: 25,
    unlocks: ['mortar-team'],
    requires: ['line-infantry-modernization']
  },
  {
    id: 'm109-digital-lay',
    name: 'M109 Digital Lay',
    description: 'Digital laying gear brings self-propelled guns onto target between rapid moves.',
    cost: 35,
    unlocks: ['spg-m109'],
    requires: ['siege-ops']
  },
  {
    id: 'elmag-rail-stabilizer',
    name: 'ELMAG Rail Stabilizer',
    description: 'Pulse control and reinforced mounts make field rail weapons safe to deploy.',
    cost: 45,
    unlocks: ['railgun-tank'],
    requires: ['m109-digital-lay']
  },
  {
    id: 'mlrs-salvo-coordination',
    name: 'MLRS Salvo Coordination',
    description: 'Networked launch control concentrates rocket strikes without overlapping fire lanes.',
    cost: 40,
    unlocks: ['mlrs-battery'],
    requires: ['elmag-rail-stabilizer']
  },
  {
    id: 'storm-assault-loadout',
    name: 'Storm Assault Loadout',
    description: 'Reinforced armor and shock weapons equip infantry for close-range assaults.',
    cost: 30,
    unlocks: ['heavy-infantry'],
    requires: ['sanctified-ammo']
  },
  {
    id: 'pyro-containment-rig',
    name: 'Pyro Containment Rig',
    description: 'Sealed fuel systems let flame teams operate safely around unstable rift matter.',
    cost: 35,
    unlocks: ['flamethrower-squad'],
    requires: ['storm-assault-loadout']
  },
  {
    id: 'forward-supply-module',
    name: 'Forward Supply Module',
    description: 'Modular stores and protected loading gear keep ammunition moving under fire.',
    cost: 20,
    unlocks: ['supply-truck'],
    requires: ['mobile-supply']
  },
  {
    id: 'paladin-ward-core',
    name: 'Paladin Ward Core',
    description: 'A compact ward generator protects heavy guns from supernatural counterfire.',
    cost: 45,
    unlocks: ['paladin-acs'],
    requires: ['arcane-shielding']
  },
  {
    id: 'destructor-siege-frame',
    name: 'Destructor Siege Frame',
    description: 'A braced walking carriage carries siege ordnance across shattered approaches.',
    cost: 60,
    unlocks: ['siege-walker'],
    requires: ['paladin-ward-core']
  },
  {
    id: 'exo-seal-system',
    name: 'Exo Seal System',
    description: 'Powered seals isolate assault suits from corrosive spores and hostile magic.',
    cost: 50,
    unlocks: ['exo-troopers'],
    requires: ['destructor-siege-frame']
  },
  {
    id: 'sky-lance-guidance',
    name: 'Sky Lance Guidance',
    description: 'Predictive guidance locks heavy interceptors onto evasive airborne monsters.',
    cost: 50,
    unlocks: ['sky-lance'],
    requires: ['wyrm-slayer', 'aegis-breakthrough-frame']
  },
  {
    id: 'firefly-light-battery',
    name: 'Firefly Light Battery',
    description: 'Air-portable gun teams provide immediate support to a fast-moving column.',
    cost: 25,
    unlocks: ['firefly-105'],
    requires: ['mobile-fire-support']
  },
  {
    id: 'badger-recoil-bed',
    name: 'Badger Recoil Bed',
    description: 'A low-profile recoil cradle fits a heavy mortar into a protected carrier.',
    cost: 30,
    unlocks: ['badger-mortar-carrier'],
    requires: ['firefly-light-battery']
  },
  {
    id: 'horizon-spectrum-array',
    name: 'Horizon Spectrum Array',
    description: 'Wide-band receivers trace hostile batteries through rift-distorted signals.',
    cost: 40,
    unlocks: ['horizon-radar'],
    requires: ['deep-fires-network']
  },
  {
    id: 'tempest-counterfire-logic',
    name: 'Tempest Counterfire Logic',
    description: 'Automated firing solutions turn sensor tracks into rapid counterbattery missions.',
    cost: 45,
    unlocks: ['tempest-counterbattery'],
    requires: ['horizon-spectrum-array']
  },
  {
    id: 'thunderhead-shell-network',
    name: 'Thunderhead Shell Network',
    description: 'Distributed fire control coordinates the longest-ranged Alliance gun batteries.',
    cost: 55,
    unlocks: ['thunderhead-155'],
    requires: ['tempest-counterfire-logic']
  },
  {
    id: 'tidewalker-amphib-drive',
    name: 'Tidewalker Amphibious Drive',
    description: 'Sealed propulsion keeps armored transports moving across flooded battle lines.',
    cost: 35,
    unlocks: ['tidewalker-apc'],
    requires: ['expeditionary-mobility']
  },
  {
    id: 'valkyrie-mobility-rig',
    name: 'Valkyrie Mobility Rig',
    description: 'Powered harnesses let assault infantry keep pace with mechanized spearheads.',
    cost: 40,
    unlocks: ['valkyrie-mobile-infantry'],
    requires: ['tidewalker-amphib-drive']
  },
  {
    id: 'breach-demolition-suite',
    name: 'Breach Demolition Suite',
    description: 'Smart charges and structural scanners open routes through fortified obstacles.',
    cost: 35,
    unlocks: ['breach-engineers'],
    requires: ['valkyrie-mobility-rig']
  },
  {
    id: 'wardog-fire-control',
    name: 'Wardog Fire Control',
    description: 'Linked cannon and missile sights create a mobile all-threat support platform.',
    cost: 45,
    unlocks: ['wardog-fire-support'],
    requires: ['breach-demolition-suite']
  },
  {
    id: 'kestrel-autonomy-kernel',
    name: 'Kestrel Autonomy Kernel',
    description: 'Resilient navigation logic lets reconnaissance drones survive signal loss.',
    cost: 35,
    unlocks: ['kestrel-recon-drone'],
    requires: ['autonomous-recon']
  },
  {
    id: 'cerberus-hunter-link',
    name: 'Cerberus Hunter Link',
    description: 'A shared sensor link guides gunships toward targets uncovered by forward drones.',
    cost: 45,
    unlocks: ['cerberus-gunship'],
    requires: ['kestrel-autonomy-kernel']
  },
  {
    id: 'aegis-breakthrough-frame',
    name: 'Aegis Breakthrough Frame',
    description: 'A reinforced hybrid chassis combines heavy armor with warded assault systems.',
    cost: 65,
    unlocks: ['aegis-assault-tank'],
    requires: ['aegis-project', 'exo-seal-system']
  }
];

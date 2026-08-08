export const operationAudioThemes = ['frontline', 'siege', 'night', 'rift'] as const;
export type OperationAudioTheme = (typeof operationAudioThemes)[number];

export interface OperationDossier {
  territoryId: string;
  chapter: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  chapterTitle: string;
  codename: string;
  situation: string;
  threat: string;
  command: string;
  victory: string;
  defeat: string;
  audioTheme: OperationAudioTheme;
}

export const starterOperationDossiers: OperationDossier[] = [
  {
    territoryId: 'sector-paris',
    chapter: 1,
    chapterTitle: 'Broken Horizon',
    codename: 'Lantern Road',
    situation: 'Evacuation trains are loading beyond the western junction while the city grid fails district by district.',
    threat: 'Hunter packs are following emergency broadcasts and probing every road that still carries light.',
    command: 'Hold the junction, keep the rail approach open, and buy the evacuation column the time it needs.',
    victory: 'The last train cleared the perimeter under its own power. The western junction is now our first dependable foothold.',
    defeat: 'The junction was overrun before the evacuation cleared. Survivors are scattering along the freight tunnels.',
    audioTheme: 'frontline'
  },
  {
    territoryId: 'sector-lyon',
    chapter: 1,
    chapterTitle: 'Broken Horizon',
    codename: 'Kiln Watch',
    situation: 'The industrial quarter still has power, machine tools, and the only intact ammunition presses west of the Rhine.',
    threat: 'Saboteurs are moving through the furnace halls behind screens of smoke and false heat signatures.',
    command: 'Lock down the factory lanes and prevent demolition teams from reaching the working production blocks.',
    victory: 'The presses are running again. Fresh ammunition will reach the field before the next operation cycle.',
    defeat: 'The foundry blocks are burning and the production line is silent. Replacement ammunition will be scarce.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-brussels',
    chapter: 1,
    chapterTitle: 'Broken Horizon',
    codename: 'Paper Eclipse',
    situation: 'A buried command archive holds the last coherent picture of the invasion routes across the northern front.',
    threat: 'Enemy scouts have breached the outer offices and are searching for the hardened records vault.',
    command: 'Reach the archive, secure its field drives, and extract before the command block is isolated.',
    victory: 'The archive is in Alliance hands. Its route tables expose a path toward the North Sea ports.',
    defeat: 'The archive went dark during extraction. Northern command must now operate from fragments and dead reckoning.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-strasbourg',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'Narrow Current',
    situation: 'One serviceable Rhine crossing connects the western depots to every force assembling in the east.',
    threat: 'Heavy assault groups are massing behind the river mist while infiltrators mark the bridge piers.',
    command: 'Hold both approaches and keep the bridge structure intact for the follow-on columns.',
    victory: 'The Rhine crossing is secure. Fuel, armor, and field hospitals can now move into the central front.',
    defeat: 'The crossing is lost and the river has split the army. Central formations are rationing fuel and ammunition.',
    audioTheme: 'frontline'
  },
  {
    territoryId: 'sector-munich',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'Cold Rampart',
    situation: 'A battered defensive line is holding the southern road network through a second night without relief.',
    threat: 'The enemy is using the blackout to shift shock troops between collapsed suburbs and abandoned rail cuts.',
    command: 'Reinforce the line, restore its observation posts, and break the next assault before dawn.',
    victory: 'The rampart held through sunrise. Central command now has a stable base for the push toward Vienna.',
    defeat: 'The defensive belt folded in the dark. Retreating units are abandoning the southern road network.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-zurich',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'White Vault',
    situation: 'Mountain shelters contain reserve power cells, medical stores, and a protected relay beneath the old fortifications.',
    threat: 'Burrowing creatures have opened new passages between the bunkers and turned the tunnel grid into an ambush maze.',
    command: 'Clear the connected shelters and bring the relay back online without collapsing the supply galleries.',
    victory: 'The vault is open and the alpine relay is transmitting. The southern flank can support sustained operations.',
    defeat: 'The tunnel grid is sealed behind the retreat. Stores and relay equipment remain trapped below the mountain.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-amsterdam',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'Tidelock',
    situation: 'The harbor cranes and tidal gates can reopen a sea route for heavy equipment that cannot cross the damaged rail net.',
    threat: 'Amphibious raiders occupy the quays and are preparing to flood the inner loading basins.',
    command: 'Retake the gate controls and clear a protected berth for the first Alliance convoy.',
    victory: 'The harbor is working under guard. Heavy cargo is already moving from ship to rail.',
    defeat: 'The inner basins flooded before the controls were secured. The northern sea route is closed.',
    audioTheme: 'frontline'
  },
  {
    territoryId: 'sector-copenhagen',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'North Needle',
    situation: 'Coastal radar on the strait is the only sensor chain watching the Baltic approach.',
    threat: 'Fast aerial and littoral units are converging beneath a storm front to blind the station permanently.',
    command: 'Defend the sensor ridge and deny the enemy a corridor around the northern flank.',
    victory: 'The North Needle is tracking again. No hostile movement can cross the strait unseen.',
    defeat: 'The sensor ridge has gone silent. Northern command is preparing for attacks without warning.',
    audioTheme: 'frontline'
  },
  {
    territoryId: 'sector-vienna',
    chapter: 2,
    chapterTitle: 'Iron Corridor',
    codename: 'Brass Ring',
    situation: 'The inner districts still shelter an organized garrison, but every surface route into the city is closing.',
    threat: 'Siege creatures and corrupted artillery are tightening a ring around the defenders quarter by quarter.',
    command: 'Punch through the siege line and open a resupply corridor before the garrison exhausts its reserves.',
    victory: 'The siege ring is broken. Vienna becomes the forward headquarters for the eastern campaign.',
    defeat: 'The relief column could not reach the inner districts. The surviving garrison is attempting a breakout.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-prague',
    chapter: 3,
    chapterTitle: 'Dead Frequencies',
    codename: 'Hollow Bell',
    situation: 'A pulse beneath the old city is repeating on military bands with no transmitter above ground.',
    threat: 'The signal bends navigation and draws isolated squads toward a ritual chamber below the street grid.',
    command: 'Descend through the service tunnels, locate the source, and sever it before the next pulse.',
    victory: 'The underground transmitter is broken. For the first time in weeks, the eastern bands carry only human voices.',
    defeat: 'The pulse continues beneath the city. Units near Prague are shutting down their radios to stay oriented.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-berlin',
    chapter: 3,
    chapterTitle: 'Dead Frequencies',
    codename: 'Dead Air Protocol',
    situation: 'Every abandoned radio in the ruins has begun broadcasting the same set of Alliance authentication codes.',
    threat: 'A signal-eating intelligence is using the dead network to predict movement and assemble defenders from the rubble.',
    command: 'Advance under emissions control, destroy the relay nests, and silence the source before it learns the full command net.',
    victory: 'The false network collapsed into static. Alliance authentication is clean and the road east is open.',
    defeat: 'The source escaped into the wider network. Command codes are being replaced across the theatre.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-warsaw',
    chapter: 3,
    chapterTitle: 'Dead Frequencies',
    codename: 'Ember Relay',
    situation: 'A field relay assembled from civilian transmitters is coordinating the last intact eastern defense brigades.',
    threat: 'Long-range fire is walking toward the relay while armored raiders cut the streets between its antenna sites.',
    command: 'Reinforce the relay perimeter and keep at least one transmission route alive throughout the assault.',
    victory: 'The Ember Relay stayed on the air. Eastern brigades are moving as one force again.',
    defeat: 'The relay ceased transmitting during the assault. Neighboring brigades are falling back on separate routes.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-krakow',
    chapter: 3,
    chapterTitle: 'Dead Frequencies',
    codename: 'Glass Choir',
    situation: 'Mirrored chambers inside the citadel are amplifying a portal tone that can be heard through concrete and armor.',
    threat: 'Resonant guardians arrive in measured waves, each one strengthening the chamber that produced it.',
    command: 'Break the outer harmonics, breach the citadel, and silence the central resonator.',
    victory: 'The citadel mirrors are dark. Their last echo reveals the true origin of the invasion signal farther east.',
    defeat: 'The choir reached full resonance. New portals are opening along the eastern approach.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-kyiv',
    chapter: 4,
    chapterTitle: 'Ash Meridian',
    codename: 'Last Broadcast',
    situation: 'The eastern city command is transmitting from a shrinking defense pocket surrounded by overlapping portal fields.',
    threat: 'Enemy artillery and airborne hunters are triangulating every broadcast from the remaining command posts.',
    command: 'Break the siege geometry, reach the command pocket, and restore a protected eastbound corridor.',
    victory: 'The last broadcast became a rally signal. The eastern pocket is linked to the Alliance line.',
    defeat: 'The final command post stopped transmitting. The eastern pocket must be treated as lost.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-carpathian',
    chapter: 4,
    chapterTitle: 'Ash Meridian',
    codename: 'Stone Vein',
    situation: 'A narrow mountain route is the only ground approach that avoids the portal storms over the plains.',
    threat: 'Patrols move through concealed cuts while rock-like sentries block the switchbacks behind them.',
    command: 'Clear the pass in sequence and establish protected fuel points for the final advance.',
    victory: 'The Stone Vein is open. Heavy formations can now approach the eastern front under cover.',
    defeat: 'The pass remains blocked and the fuel column has turned back. The final advance loses its southern route.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-blacksea',
    chapter: 4,
    chapterTitle: 'Ash Meridian',
    codename: 'Drowned Line',
    situation: 'A coastal pumping station sits above a submerged breach that feeds creatures into the southern flank.',
    threat: 'The breach rises with each tide, bringing armored shapes through flooded service channels.',
    command: 'Secure the station, hold the seawall, and collapse the submerged approach before the tide peaks.',
    victory: 'The breach is buried beneath the seawall. The southern flank is quiet and the coast road is secure.',
    defeat: 'The seawall failed under pressure. Coastal units are withdrawing inland ahead of the next tide.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-rift',
    chapter: 4,
    chapterTitle: 'Ash Meridian',
    codename: 'Ash Crown',
    situation: 'All captured signal paths converge on a burning fracture where the sky and ground no longer agree.',
    threat: 'The breach is assembling a final guard from every defeated pattern while its warden descends through the opening.',
    command: 'Break the ward line, survive the converging guard, and collapse the fracture from within its perimeter.',
    victory: 'The Ash Crown is broken. The fracture is shrinking, hostile formations are losing cohesion, and dawn reaches the eastern line.',
    defeat: 'The fracture remains open and the warden holds the field. Alliance command is preparing one last defensive line in the west.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-cinder-gate',
    chapter: 5,
    chapterTitle: 'Veilbreak',
    codename: 'Cinder Gate',
    situation: 'The sealed Eastern Rift has exposed a narrow passage into a fractured landscape under an unfamiliar sky.',
    threat: 'The passage is collapsing in pulses while fresh defenders gather around a ring of heat-scarred pylons.',
    command: 'Cross before the next collapse, break the pylon ring, and establish a signal anchor on the far side.',
    victory: 'The anchor is holding and the passage has stabilized. Scout signals now reveal two routes into the Shatterline.',
    defeat: 'The vanguard was scattered when the passage folded. Survivors are transmitting from a dark shoreline farther south.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-lantern-vault',
    chapter: 5,
    chapterTitle: 'Veilbreak',
    codename: 'Lantern Vault',
    situation: 'Scouts from the successful crossing found an underground observatory whose instruments still chart the broken sky.',
    threat: 'Stone sentries are cutting through the outer galleries while a trapped survey team races to stabilize a failing prism.',
    command: 'Cover the survey team and calibrate the observatory prism before round seven closes the last clear sightline.',
    victory: 'The prism is stable and the survey team is safe. Its measurements turn the Shatterline from a void into navigable ground.',
    defeat: 'The prism lost alignment before the survey team could finish. The next advance must proceed without reliable bearings.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-hollow-tide',
    chapter: 5,
    chapterTitle: 'Veilbreak',
    codename: 'Hollow Tide',
    situation: 'Scattered survivors of the failed crossing have formed a perimeter on a shore where the water withdraws without warning.',
    threat: 'Each retreating wave uncovers dormant war forms that advance through the mist toward the stranded signal beacons.',
    command: 'Silence the tide-callers, hold the beacon ridge, and reopen a stable route to the surviving vanguard.',
    victory: 'The tide-callers are gone and the beacon ridge is secure. The stranded vanguard has become a new foothold.',
    defeat: 'The black tide covered the beacon ridge before the line could reform. Contact with the surviving vanguard is fading.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-ashen-confluence',
    chapter: 6,
    chapterTitle: 'Crossed Bearings',
    codename: 'Ashen Confluence',
    situation: 'Both expedition routes have reached a fault where roads from separate horizons overlap for only a few hours at a time.',
    threat: 'The joined ground shifts under the convoy while hostile observers mark each stable crossing for destruction.',
    command: 'Escort the survey convoy through the fault, preserve its navigation core, and align the echo beacon if the field permits.',
    victory: 'The convoy crossed intact and its instruments now reconcile both route surveys into one dependable advance.',
    defeat: 'The fault closed around the convoy before the navigation core cleared the crossing. Both fronts have lost their common bearings.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-sable-causeway',
    chapter: 6,
    chapterTitle: 'Crossed Bearings',
    codename: 'Sable Causeway',
    situation: 'A road of black stone spans the northern void and offers the only armored approach toward the inner Shatterline.',
    threat: 'Ward towers are bending the causeway in sections while a commando wardbreaker searches for the control seam.',
    command: 'Escort the attached wardbreaker and plant the charges by round ten before the span folds beneath the column.',
    victory: 'The ward towers are silent and the causeway is carrying armor toward the inner line without distortion.',
    defeat: 'The causeway folded before the controls were secured. Northern formations are stranded on separated spans.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-mnemonic-orchard',
    chapter: 6,
    chapterTitle: 'Crossed Bearings',
    codename: 'Mnemonic Orchard',
    situation: 'A forest of translucent trunks is broadcasting voices and orders copied from every Alliance loss since the first contact.',
    threat: 'Signal mimics are closing on an attached PSI specialist who can ground the memory lattice beneath the root relay.',
    command: 'Cover the specialist and ground the lattice by round nine, then hold the relay when the orchard answers.',
    victory: 'The root relay is quiet. The copied voices have faded, and the southern advance can trust its own signals again.',
    defeat: 'The orchard still owns the command band. Southern units are withdrawing rather than follow another perfect imitation.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-thorn-engine',
    chapter: 7,
    chapterTitle: 'Contracting Sky',
    codename: 'Thorn Engine',
    situation: 'The two secured fronts are being dragged together by a regulator whose moving towers tighten the landscape around them.',
    threat: 'Each contraction crushes another route and releases a fresh guard from the engine housing.',
    command: 'Take the control ring, hold it through the reversal sequence, and keep Captain Halden alive while the field teams work.',
    victory: 'The regulator has reversed. The fronts are stable, and a direct corridor now points toward the source beneath the Shatterline.',
    defeat: 'The control ring was lost during the reversal. The two fronts are collapsing toward the same hostile center.',
    audioTheme: 'siege'
  },
  {
    territoryId: 'sector-veil-heart',
    chapter: 8,
    chapterTitle: 'The Second Horizon',
    codename: 'Veil Heart',
    situation: 'Every fracture and false horizon is pulsing with a buried core that is beginning to take a single physical shape.',
    threat: 'The heart is rebuilding its guard from remembered battlefields while the last horizon closes around the assault force.',
    command: 'Break the ritual guard, anchor the chamber, and destroy the heart before the Shatterline seals with the army inside.',
    victory: 'The Veil Heart is still. False horizons are collapsing into open sky, and the passage home is holding.',
    defeat: 'The heart completed its contraction. The assault force is cut off beneath a sky that no longer opens toward home.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-quiet-meridian',
    chapter: 8,
    chapterTitle: 'Dawn Protocol',
    codename: 'Quiet Meridian',
    situation: 'The Veil Heart is dead, but the return passage has lost its bearing among ruins that are collapsing out of sequence.',
    threat: 'A stranded survey team carries the only intact meridian record while remnant guards close through the falling galleries.',
    command: 'Reach the survey team, keep it alive, and escort its record to the extraction line before the ruins erase the route.',
    victory: 'The meridian record is secure. Alliance navigation now has one fixed line through the collapsing Shatterline.',
    defeat: 'The ruins closed over the survey team and its record. The return passage is open, but no longer points toward home.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-glass-wake',
    chapter: 8,
    chapterTitle: 'Dawn Protocol',
    codename: 'Glass Wake',
    situation: 'The broken horizon has drained into a mirrored tide that covers the southern approach to the return line.',
    threat: 'Shore guards are folding the last solid crossing into the reflection while the tide rises behind the assault force.',
    command: 'Break the shore guard and secure the far crossing before the mirrored water cuts the army in two.',
    victory: 'The crossing is stable and the Glass Wake is receding. Heavy formations can now reach the return corridor.',
    defeat: 'The reflected tide reclaimed the crossing. The southern column is isolated on ground that disappears with every wave.',
    audioTheme: 'rift'
  },
  {
    territoryId: 'sector-ash-compass',
    chapter: 8,
    chapterTitle: 'Dawn Protocol',
    codename: 'Ash Compass',
    situation: 'A mobile stabilizer can align the rescued meridian, but the shortest route crosses a forest displaced from another horizon.',
    threat: 'Every hostile signal rotates the paths around the convoy and draws fresh hunters toward its navigation core.',
    command: 'Escort the stabilizer through the forest, protect its core, and deliver it to the final bearing intact.',
    victory: 'The Ash Compass is aligned. For the first time since the crossing, every Alliance receiver points toward the same dawn.',
    defeat: 'The stabilizer was lost among the turning paths. Formations are following different bearings into the same forest.',
    audioTheme: 'night'
  },
  {
    territoryId: 'sector-dawn-anchor',
    chapter: 8,
    chapterTitle: 'Dawn Protocol',
    codename: 'Dawn Anchor',
    situation: 'The return passage is fixed and evacuation has begun, but sealing it requires an anchor held on the hostile side.',
    threat: 'Every surviving Shatterline war form is converging on the anchor before the last Alliance formation can cross.',
    command: 'Hold the anchor through the sealing cycle and deny the final assault access to the return passage.',
    victory: 'The last formation is home and the Dawn Anchor is sealed. The second horizon has closed without a road back.',
    defeat: 'The anchor fell before the sealing cycle finished. The return passage is tearing open under the final assault.',
    audioTheme: 'siege'
  }
];

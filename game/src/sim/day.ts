// The night passes: crops grow, the weather turns, wages are paid, and the morning report is written.
import { DAY_START, SEASON_DAYS } from '../core/config';
import { CROPS, ITEMS } from '../data';
import { addItem } from './inventory';
import { Season } from '../core/config';
import { WeatherKind, dayOfSeason, seasonOf } from './state';
import { PLACES } from './worldgen';
import { idx } from './world';
import type { Sim } from './sim';

const WEATHER: Record<Season, [WeatherKind, number][]> = {
  Wet: [['rain', 0.4], ['cloud', 0.3], ['clear', 0.3]],
  Green: [['clear', 0.5], ['cloud', 0.25], ['rain', 0.2], ['dust', 0.05]],
  Dry: [['clear', 0.55], ['dust', 0.25], ['cloud', 0.15], ['rain', 0.05]],
  Cold: [['cloud', 0.35], ['clear', 0.3], ['frost', 0.2], ['rain', 0.15]]
};

export function rollWeather(sim: Sim, season: Season): WeatherKind {
  const r = sim.rng();
  let acc = 0;
  for (const [k, p] of WEATHER[season]) {
    acc += p;
    if (r < acc) return k;
  }
  return 'clear';
}

export function endDay(sim: Sim, passedOut: boolean): void {
  const st = sim.state;
  const w = sim.world;
  const report: string[] = [];
  sim.collectPickups();
  // The rest of the night happens while you sleep
  report.push(...sim.night.resolveOffscreen());
  sim.night.husks = [];
  sim.action = null;
  sim.roll = null;

  // If the truck is still parked when you sleep early, it collects before it goes
  if (sim.trader.visitToday() && st.minute < 17 * 60 && sim.trader.truck.state !== 'away') sim.trader.collect();
  if (st.trader.lastPaid > 0) report.push(`The Hull truck paid ${st.trader.lastPaid} scrip for the crate.`);
  st.trader.lastPaid = 0;

  // ---- Crops grow overnight
  const frost = st.weather === 'frost';
  let thirsty = 0;
  let grew = 0;
  let ripened = 0;
  for (const [k, c] of w.crops) {
    if (c.dead) continue;
    const def = CROPS[c.kind];
    if (c.wet) {
      c.dry = 0;
      if (frost && !def.hardy) continue;
      c.care++;
      if (c.picked && def.regrow) {
        if (c.regrowIn > 0) c.regrowIn--;
        if (c.regrowIn <= 0 && !c.ripe) {
          c.ripe = true;
          ripened++;
        }
      } else if (!c.ripe) {
        c.age++;
        grew++;
        if (c.age >= def.days) {
          c.ripe = true;
          ripened++;
        }
      }
    } else {
      c.dry += st.weather === 'dust' ? 2 : 1;
      if (c.dry >= 3) {
        c.dead = true;
        c.ripe = false;
        thirsty++;
      }
    }
    void k;
  }
  if (thirsty) report.push(`${thirsty} ${thirsty === 1 ? 'crop' : 'crops'} died of thirst.`);
  if (ripened) report.push(`${ripened} ${ripened === 1 ? 'crop is' : 'crops are'} ready to pick.`);
  const trampled = Number(st.flags.trampled ?? 0);
  if (trampled) report.push(`Husks trampled ${trampled} ${trampled === 1 ? 'crop' : 'crops'} in the night.`);
  st.flags.trampled = 0;

  // Soil dries; turned soil with nothing in it slowly goes back
  for (let k = 0; k < w.tilled.length; k++) {
    w.wet[k] = 0;
    if (w.tilled[k]) {
      if (w.crops.has(k)) w.tilled[k] = 1;
      else if (++w.tilled[k] > 5 && sim.rng() < 0.4) w.tilled[k] = 0;
    }
  }
  for (const c of w.crops.values()) c.wet = false;

  // Compost bins
  for (const o of w.objects.values()) {
    if (o.kind !== 'compost_bin' || !o.s) continue;
    if (Number(o.s.load ?? 0) > 0 && !o.s.ready) {
      o.s.days = Number(o.s.days ?? 0) + 1;
      if (Number(o.s.days) >= 2) {
        o.s.ready = 1;
        report.push('The compost bin is ready.');
      }
    }
  }

  // ---- Hands
  report.push(...sim.hands.endDay());

  // ---- Next day
  const oldSeason = seasonOf(st.day);
  st.day++;
  const season = seasonOf(st.day);
  if (season !== oldSeason) {
    let lost = 0;
    for (const c of w.crops.values()) {
      if (!c.dead && !CROPS[c.kind].seasons.includes(season)) {
        c.dead = true;
        lost++;
      }
    }
    report.unshift(`The ${season} season begins.${lost ? ` ${lost} crops could not take the change and died.` : ''}`);
    st.journal.push({ day: st.day, text: `The ${season} season began.` });
  }
  st.weather = st.tomorrow;
  st.tomorrow = rollWeather(sim, seasonOf(st.day + 1));
  if (st.weather === 'rain') {
    for (let k = 0; k < w.tilled.length; k++) if (w.tilled[k]) w.wet[k] = 1;
    for (const c of w.crops.values()) c.wet = true;
    for (const o of w.objects.values()) if (o.kind === 'rain_barrel') o.s = { water: 1 };
    report.push('It is raining. The field is watered.');
  } else if (st.weather === 'dust') report.push('A dust storm is blowing in from the east. Dry crops will suffer.');
  else if (st.weather === 'frost') report.push('Frost on the ground. Only hardy crops will grow tonight.');

  // Sprinklers water the four tiles beside them
  for (const o of w.objects.values()) {
    if (o.kind !== 'sprinkler') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = idx(o.x + dx, o.y + dy);
      if (w.tilled[k]) {
        w.wet[k] = 1;
        const c = w.crops.get(k);
        if (c) c.wet = true;
      }
    }
  }

  // ---- The player
  const ps = st.player;
  const late = st.minute > 24 * 60;
  if (passedOut) {
    const lost = Math.min(100, Math.floor(ps.scrip * 0.15));
    ps.scrip -= lost;
    ps.stamina = Math.round(ps.maxStamina * 0.55);
    ps.hp = Math.max(ps.hp, Math.round(sim.maxHp() * 0.5));
    if (st.flags.downed) {
      report.unshift(`Something dragged you back to the house. You do not remember the walk.${lost ? ` ${lost} scrip is missing.` : ''}`);
      st.flags.downed = 0;
    } else report.unshift(`You woke in the dirt with the sun on your face.${lost ? ` ${lost} scrip is missing.` : ''}`);
  } else {
    ps.stamina = late ? Math.round(ps.maxStamina * 0.8) : ps.maxStamina;
    ps.hp = Math.min(sim.maxHp(), ps.hp + 40);
  }
  ps.dose = Math.max(0, ps.dose - 6);
  ps.hp = Math.min(ps.hp, sim.maxHp());
  ps.x = PLACES.bed.x;
  ps.y = PLACES.bed.y;
  ps.dir = 1;
  sim.player.x = ps.x;
  sim.player.y = ps.y;
  sim.player.dir = 1;
  sim.player.anim = 'idle';
  sim.dead = false;
  ps.lantern = false;

  sim.trader.newDay();
  sim.hands.maybeApplicant();
  if (sim.trader.visitToday()) report.push('The Hull truck comes today. It parks at the depot from eight until five.');
  if (dayOfSeason(st.day) === SEASON_DAYS - 2) report.push(`Two days left in the ${season} season.`);

  st.minute = DAY_START;
  report.push(...sim.notes);
  sim.notes = [];
  st.report = report;
  sim.emit({ t: 'dayEnded', passedOut });
  void ITEMS;
  void addItem;
}

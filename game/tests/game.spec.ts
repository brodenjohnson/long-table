// Regression tests. They drive the game through window.__game and check the simulation.
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, difficulty = 'normal'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.ready, null, { timeout: 30_000 });
  await page.evaluate(d => {
    localStorage.clear();
    (window as any).__game.newGame('Tester', d);
  }, difficulty);
  return errors;
}

test('boots to a new game with no errors', async ({ page }) => {
  const errors = await boot(page);
  const st = await page.evaluate(() => {
    const s = (window as any).__game.sim;
    return { day: s.state.day, hoe: s.state.inv[0]?.id, running: (window as any).__game.running, objects: s.world.objects.size };
  });
  expect(st.day).toBe(1);
  expect(st.hoe).toBe('hoe');
  expect(st.running).toBe(true);
  expect(st.objects).toBeGreaterThan(200);
  await page.waitForTimeout(500);
  expect(errors.filter(e => !e.includes('404'))).toEqual([]);
});

test('till, plant, water, grow and harvest', async ({ page }) => {
  await boot(page, 'peaceful');
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    const tx = 47, ty = 40;
    const o = w.objectAt(tx, ty);
    if (o) w.remove(o);
    s.player.x = tx + 0.5;
    s.player.y = ty + 1.6;
    const aim = { x: tx + 0.5, y: ty + 0.5 };
    // Hoe
    s.state.sel = 0;
    g.stepWith({ usePressed: true, use: true, aim });
    g.advance(0.6);
    const tilled = w.tilled[ty * 96 + tx];
    // Radish seed is slot 5
    s.state.sel = 5;
    g.stepWith({ usePressed: true, use: true, aim });
    const planted = w.crops.has(ty * 96 + tx);
    // Water
    s.state.sel = 1;
    g.stepWith({ usePressed: true, use: true, aim });
    g.advance(0.6);
    const wet = w.wet[ty * 96 + tx];
    // Sleep through four nights, watering each morning
    for (let d = 0; d < 4; d++) {
      s.requestSleep();
      g.advance(0.05);
      g.closeUi();
      const k = ty * 96 + tx;
      w.wet[k] = 1;
      const c = w.crops.get(k);
      if (c) c.wet = true;
    }
    const crop = w.crops.get(ty * 96 + tx);
    const ripe = crop?.ripe;
    const before = s.state.inv.filter((x: any) => x && x.id === 'radish').reduce((a: number, x: any) => a + x.n, 0);
    s.state.sel = 0;
    // Sleeping puts you back at the house; walk back to the crop
    s.player.x = tx + 0.5;
    s.player.y = ty + 1.6;
    g.stepWith({ interact: true, aim });
    const after = s.state.inv.filter((x: any) => x && x.id === 'radish').reduce((a: number, x: any) => a + x.n, 0);
    return { tilled, planted, wet, ripe, gained: after - before, day: s.state.day };
  });
  expect(r.tilled).toBeTruthy();
  expect(r.planted).toBe(true);
  expect(r.wet).toBe(1);
  expect(r.day).toBe(5);
  expect(r.ripe).toBe(true);
  expect(r.gained).toBeGreaterThan(0);
});

test('the Hull truck pays for the depot crate', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    s.state.depot.push({ id: 'potato', n: 10, q: 1 });
    const before = s.state.player.scrip;
    // Day 2 is a Tuesday: truck comes 08:00 to 17:00
    s.requestSleep();
    g.advance(0.05);
    g.closeUi();
    s.state.minute = 8 * 60;
    g.advance(20);
    const parked = s.trader.truck.state;
    s.state.minute = 16 * 60 + 59;
    g.advance(3);
    return { parked, paid: s.state.player.scrip - before, crate: s.state.depot.length, leaving: s.trader.truck.state };
  });
  expect(r.parked).toBe('parked');
  expect(r.paid).toBeGreaterThan(200);
  expect(r.crate).toBe(0);
  expect(['out', 'away']).toContain(r.leaving);
});

test('husks come at night and can be put down', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    s.state.minute = 21 * 60 + 29;
    g.advance(2);
    const came = s.night.husks.length;
    // Put one right in front of the player and swing at it
    s.night.husks = [];
    const h = s.night.spawn({ x: s.player.x + 0.8, y: s.player.y });
    s.state.sel = 4; // machete
    for (let i = 0; i < 12 && h.hp > 0; i++) {
      g.stepWith({ usePressed: true, use: true, aim: { x: h.x, y: h.y } });
      g.advance(0.5);
      h.x = s.player.x + 0.8;
      h.y = s.player.y;
    }
    return { came, dead: h.state === 'dead', kills: s.state.stats.husks };
  });
  expect(r.came).toBeGreaterThan(0);
  expect(r.dead).toBe(true);
  expect(r.kills).toBe(1);
});

test('dying at night wakes you the next morning', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    s.state.minute = 22 * 60;
    s.hurtPlayer(500, s.player.x + 1, s.player.y);
    g.advance(3.2);
    g.closeUi();
    return { day: s.state.day, hp: s.state.player.hp, dead: s.dead };
  });
  expect(r.day).toBe(2);
  expect(r.hp).toBeGreaterThan(0);
  expect(r.dead).toBe(false);
});

test('save and load keep the farm', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    w.tilled[40 * 96 + 50] = 1;
    w.crops.set(40 * 96 + 50, { kind: 'corn', age: 3, wet: true, dry: 0, ripe: false, regrowIn: 0, picked: false, care: 3, dead: false });
    w.add('fence', 60, 45);
    s.state.player.scrip = 777;
    g.game.save();
    return { objects: w.objects.size, slot: g.game.slot };
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.ready);
  const after = await page.evaluate(slot => {
    const g = (window as any).__game;
    g.game.load(slot);
    const s = g.sim;
    const w = s.world;
    return { objects: w.objects.size, corn: w.crops.get(40 * 96 + 50)?.age, fence: w.objectAt(60, 45)?.kind, scrip: s.state.player.scrip };
  }, before.slot);
  expect(after.objects).toBe(before.objects);
  expect(after.corn).toBe(3);
  expect(after.fence).toBe('fence');
  expect(after.scrip).toBe(777);
});

test('a hand turns up, is hired and waters the field', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    // Get to day 3, when the first drifter always comes
    for (let d = 0; d < 2; d++) {
      s.requestSleep();
      g.advance(0.05);
      g.closeUi();
    }
    const applicant = s.state.applicant?.id;
    w.add('bunk', 36, 46);
    s.hands.hire(applicant);
    // A dry crop for them to water
    for (let x = 46; x < 49; x++) {
      const k = 41 * 96 + x;
      const o = w.objectAt(x, 41);
      if (o) w.remove(o);
      w.tilled[k] = 1;
      w.crops.set(k, { kind: 'radish', age: 1, wet: false, dry: 0, ripe: false, regrowIn: 0, picked: false, care: 1, dead: false });
    }
    s.state.minute = 8 * 60;
    g.advance(40);
    let wet = 0;
    for (let x = 46; x < 49; x++) if (w.wet[41 * 96 + x]) wet++;
    return { applicant, hands: s.state.hands.length, bunk: s.state.hands[0]?.bunk, wet };
  });
  expect(r.applicant).toBeTruthy();
  expect(r.hands).toBe(1);
  expect(r.bunk).toBeGreaterThan(0);
  expect(r.wet).toBeGreaterThan(0);
});

test('sunflowers clean contaminated ground', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    const k = 47 * 96 + 54;
    const before = w.contam[k];
    w.tilled[k] = 1;
    w.crops.set(k, { kind: 'sunflower', age: 7, wet: true, dry: 0, ripe: true, regrowIn: 0, picked: false, care: 7, dead: false });
    s.harvestAt(54, 47);
    return { before, after: w.contam[k] };
  });
  expect(r.before).toBeGreaterThan(0.38);
  expect(r.after).toBeLessThan(r.before - 0.2);
});

test('sleeping early does not skip the night: unguarded crops get trampled, a fence holds', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    const plantField = () => {
      for (let y = 40; y < 48; y++)
        for (let x = 46; x < 56; x++) {
          const k = y * 96 + x;
          const o = w.objectAt(x, y);
          if (o && o.kind !== 'fence' && o.kind !== 'gate') w.remove(o);
          w.tilled[k] = 1;
          w.crops.set(k, { kind: 'radish', age: 1, wet: true, dry: 0, ripe: false, regrowIn: 0, picked: false, care: 1, dead: false });
        }
    };
    // Night one, day 8 so there are plenty of Husks, no fence
    s.state.day = 8;
    plantField();
    s.state.minute = 19 * 60;
    s.requestSleep();
    g.advance(0.05);
    g.closeUi();
    let dead1 = 0;
    for (const c of w.crops.values()) if (c.dead) dead1++;
    // Night two: ring the field with fence
    w.crops.clear();
    plantField();
    for (let x = 44; x <= 58; x++) for (const y of [37, 52]) { const o = w.objectAt(x, y); if (o) w.remove(o); w.add('fence', x, y); }
    for (let y = 38; y <= 51; y++) for (const x of [44, 58]) { const o = w.objectAt(x, y); if (o) w.remove(o); w.add('fence', x, y); }
    const enclosed = s.night.fieldEnclosed();
    s.state.minute = 19 * 60;
    s.requestSleep();
    g.advance(0.05);
    g.closeUi();
    let dead2 = 0;
    for (const c of w.crops.values()) if (c.dead) dead2++;
    return { dead1, dead2, enclosed, report: s.state.report };
  });
  expect(r.dead1).toBeGreaterThan(0);
  expect(r.enclosed).toBe(true);
  expect(r.dead2).toBeLessThan(r.dead1);
});

test('a hand on guard fights Husks at night', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    s.hands.hire('tomas');
    const h = s.state.hands[0];
    h.job = 'guard';
    s.state.minute = 22 * 60;
    h.x = 52; h.y = 36.5;
    s.player.x = 30; s.player.y = 60;
    const hk = s.night.spawn({ x: 54, y: 36.5 });
    g.advance(12);
    return { husk: hk.state, hp: hk.hp };
  });
  expect(r.hp).toBeLessThan(44);
});

test('the steel hoe turns three tiles at once', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.sim;
    const w = s.world;
    s.state.inv[0] = { id: 'hoe2', n: 1 };
    s.state.sel = 0;
    for (let x = 46; x < 52; x++) { const o = w.objectAt(x, 42); if (o) w.remove(o); }
    s.player.x = 45.5; s.player.y = 42.5;
    g.stepWith({ usePressed: true, use: true, aim: { x: 46.5, y: 42.5 } });
    g.advance(0.6);
    let n = 0;
    for (let x = 46; x < 50; x++) if (w.tilled[42 * 96 + x]) n++;
    return n;
  });
  expect(r).toBe(3);
});

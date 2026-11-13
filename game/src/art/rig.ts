// Characters drawn from a small 3D skeleton, posed per animation frame and seen from any of 8 directions.
// The shapes are drawn smooth, then made crisp and outlined so they read as pixel art.
import { Atlas } from './atlas';
import { Cv, crisp, ellipse, line, makeCanvas, outline, shade } from './pixel';

export interface Look {
  id: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald' | 'tied' | 'shaggy';
  shirt: string;
  sleeve?: string;
  pants: string;
  boots: string;
  coat?: string;
  scarf?: string;
  hat?: 'cap' | 'brim' | 'beanie';
  hatColour?: string;
  build?: number;
  /** Forward lean of the torso, radians. Husks stoop. */
  hunch?: number;
  /** Arms held forward at rest, radians. */
  reach?: number;
  eyes?: string;
  gown?: boolean;
  armband?: string;
}

export type Anim = 'idle' | 'walk' | 'swing' | 'pour' | 'shoot' | 'roll' | 'hurt' | 'dead' | 'claw';
export type Tool = 'hoe' | 'axe' | 'pick' | 'machete' | 'can' | 'pistol' | 'none';

export const FRAMES: Record<Anim, number> = { idle: 2, walk: 6, swing: 4, pour: 2, shoot: 2, roll: 4, hurt: 1, dead: 1, claw: 4 };

type V3 = { s: number; u: number; z: number };

interface Pose {
  bob: number;
  lean: number;
  legL: [number, number]; // thigh angle, knee bend
  legR: [number, number];
  armL: [number, number]; // upper arm angle (forward positive), elbow bend
  armR: [number, number];
  armSpreadL?: number;
  armSpreadR?: number;
  /** Tool angle relative to the forearm, radians. */
  toolTilt: number;
  crouch: number;
  lying?: boolean;
}

function pose(anim: Anim, f: number, look: Look): Pose {
  const reach = look.reach ?? 0.12;
  const p: Pose = { bob: 0, lean: look.hunch ?? 0, legL: [0, 0.05], legR: [0, 0.05], armL: [reach, 0.25], armR: [reach, 0.25], toolTilt: 1.2, crouch: 0 };
  switch (anim) {
    case 'idle':
      p.bob = f === 1 ? -0.5 : 0;
      p.armL = [reach + 0.04, 0.2 + f * 0.05];
      p.armR = [reach + 0.04, 0.2 + f * 0.05];
      break;
    case 'walk': {
      const ph = (f / 6) * Math.PI * 2;
      const sw = Math.sin(ph);
      p.legL = [0.5 * sw, 0.15 + Math.max(0, -Math.cos(ph)) * 0.75];
      p.legR = [-0.5 * sw, 0.15 + Math.max(0, Math.cos(ph)) * 0.75];
      p.armL = [reach - 0.45 * sw, 0.35];
      p.armR = [reach + 0.45 * sw, 0.35];
      p.bob = -Math.abs(Math.cos(ph)) * 0.9 + 0.4;
      if (look.hunch) p.lean += 0.05 * sw;
      break;
    }
    case 'swing': {
      const arm = [-2.5, -2.9, 0.75, 0.55][f];
      const elbow = [0.9, 0.5, 0.15, 0.3][f];
      p.armR = [arm, elbow];
      p.armL = [arm + 0.1, elbow + 0.15];
      p.armSpreadL = 0.45;
      p.lean += [-0.12, -0.18, 0.25, 0.2][f];
      p.legL = [0.25, 0.2];
      p.legR = [-0.2, 0.3];
      p.bob = [0, -0.5, 0.3, 0.2][f];
      p.toolTilt = [1.3, 1.5, 1.1, 1.0][f];
      break;
    }
    case 'claw': {
      const arm = [0.4, -0.6, 1.4, 1.1][f];
      p.armR = [arm, 0.2];
      p.armL = [arm - 0.2, 0.3];
      p.lean += [0, -0.1, 0.35, 0.3][f];
      p.legL = [0.3, 0.2];
      p.legR = [-0.25, 0.3];
      break;
    }
    case 'pour':
      p.armR = [1.15, 0.2 + f * 0.1];
      p.armL = [0.3, 0.4];
      p.lean += 0.1;
      p.toolTilt = 0.4 + f * 0.35;
      break;
    case 'shoot':
      p.armR = [1.55 + f * 0.25, 0.02];
      p.armL = [1.35 + f * 0.2, 0.2];
      p.armSpreadL = -0.6;
      p.lean += -0.05 * f;
      p.legL = [0.2, 0.1];
      p.legR = [-0.2, 0.15];
      p.toolTilt = 1.6;
      break;
    case 'roll': {
      p.crouch = [0.35, 0.6, 0.6, 0.35][f];
      p.lean += [0.6, 0.9, 0.9, 0.5][f];
      p.legL = [1.2, 2.0];
      p.legR = [1.0, 2.1];
      p.armL = [1.1, 1.2];
      p.armR = [1.0, 1.3];
      break;
    }
    case 'hurt':
      p.lean += -0.3;
      p.armL = [0.6, 0.6];
      p.armR = [0.5, 0.7];
      p.armSpreadL = 0.5;
      p.armSpreadR = 0.5;
      break;
    case 'dead':
      p.lying = true;
      p.armL = [0.4, 0.3];
      p.armR = [-0.3, 0.6];
      p.legL = [0.15, 0.1];
      p.legR = [-0.1, 0.2];
      break;
  }
  return p;
}

const HIP_Z = 12;
const CHEST_Z = 18.5;
const SHOULDER_Z = 19.2;
const HEAD_Z = 23.6;
const THIGH = 5.6;
const SHIN = 5.6;
const UPPER = 4.4;
const FORE = 4.0;

function limb(start: V3, a1: number, l1: number, bend: number, l2: number, spread = 0, back = false): [V3, V3] {
  // Angles are from straight down, positive forward. A knee bends backward, an elbow forward.
  const k = back ? -1 : 1;
  const mid: V3 = { s: start.s + Math.sin(spread) * l1 * 0.6 * Math.sign(start.s || 1), u: start.u + Math.sin(a1) * l1, z: start.z - Math.cos(a1) * l1 };
  const a2 = a1 + bend * k;
  const end: V3 = { s: mid.s + Math.sin(spread) * l2 * 0.4 * Math.sign(start.s || 1), u: mid.u + Math.sin(a2) * l2, z: mid.z - Math.cos(a2) * l2 };
  return [mid, end];
}

interface Part {
  depth: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** Paint one frame. `dir` is a screen direction 0..7 clockwise from east. */
export function paintCharacter(look: Look, anim: Anim, frame: number, dir: number, tool: Tool): Cv {
  const W = 44;
  const H = 46;
  const ox = 22;
  const oy = 40;
  const cv = makeCanvas(W, H);
  const ctx = cv.ctx;
  const p = pose(anim, frame, look);
  const build = look.build ?? 1;
  const a = (dir * Math.PI) / 4;
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  // Right-hand side, as the character sees it
  const rx = -fy;
  const ry = fx;
  const drop = p.crouch * 6;

  // Torso leans forward around the hips
  const leanPt = (v: V3): V3 => {
    if (v.z <= HIP_Z - drop) return v;
    const dz = v.z - (HIP_Z - drop);
    return { s: v.s, u: v.u + Math.sin(p.lean) * dz, z: HIP_Z - drop + Math.cos(p.lean) * dz };
  };

  const toScreen = (v: V3): [number, number, number] => {
    let u = v.u;
    let z = v.z;
    if (p.lying) {
      // Fall onto the back: height becomes distance behind the feet, centred on the anchor
      u = -v.z * 0.8 + 9 + v.u * 0.3;
      z = 1.5 + v.u * 0.15;
    }
    const gx = v.s * rx * build + u * fx;
    const gy = v.s * ry * build + u * fy;
    return [ox + gx, oy + gy * 0.5 - z - p.bob, gy];
  };

  const parts: Part[] = [];
  const capsule = (a0: V3, a1: V3, r: number, c: string, hi = true) => {
    const A = toScreen(a0);
    const B = toScreen(a1);
    parts.push({
      depth: (A[2] + B[2]) / 2,
      draw: g => {
        line(g, A[0], A[1], B[0], B[1], r * 2, c);
        if (hi && r >= 1.2) line(g, A[0] - 0.6, A[1] - 0.4, B[0] - 0.6, B[1] - 0.4, Math.max(1, r * 0.9), shade(c, 0.16));
      }
    });
  };

  const hipZ = HIP_Z - drop;
  // Legs
  for (const side of [-1, 1] as const) {
    const lg = side < 0 ? p.legL : p.legR;
    const hip: V3 = { s: 1.9 * side, u: 0, z: hipZ };
    const [knee, foot] = limb(hip, lg[0], THIGH * (1 - p.crouch * 0.2), -lg[1], SHIN * (1 - p.crouch * 0.2));
    capsule(hip, knee, 1.7, look.pants);
    capsule(knee, { ...foot, z: foot.z + 1.2 }, 1.5, look.pants);
    // Boot: a short capsule pointing forward
    const toe: V3 = { s: foot.s, u: foot.u + 1.6, z: foot.z + 0.4 };
    capsule({ ...foot, z: foot.z + 0.9 }, toe, 1.35, look.boots, false);
  }

  // Torso
  const pelvis = leanPt({ s: 0, u: 0, z: hipZ + 0.5 });
  const chest = leanPt({ s: 0, u: 0, z: CHEST_Z - drop });
  const torsoColour = look.coat ?? look.shirt;
  capsule(pelvis, chest, 3.3 * build, look.gown ? look.shirt : torsoColour);
  if (look.coat) {
    // Shirt shows at the front opening
    const front = toScreen(leanPt({ s: 0, u: 2.4, z: CHEST_Z - drop - 1 }));
    const front2 = toScreen(leanPt({ s: 0, u: 2.6, z: hipZ + 3 }));
    if (fy > -0.2) parts.push({ depth: front[2] + 0.5, draw: g => line(g, front[0], front[1], front2[0], front2[1], 1.4, look.shirt) });
    // Coat tails
    const t0 = leanPt({ s: 0, u: -0.3, z: hipZ + 1 });
    capsule(t0, { s: 0, u: -0.6, z: hipZ - 4 }, 3.0 * build, shade(look.coat, -0.08), false);
  }
  if (look.gown) {
    // A torn sleep-pod gown hangs to the knee
    capsule({ s: 0, u: 0, z: hipZ + 1 }, { s: 0, u: 0.4, z: hipZ - 5 }, 3.1, shade(look.shirt, -0.1), false);
  }
  if (look.armband) {
    const ab = toScreen(leanPt({ s: 3.4 * -1, u: 0, z: SHOULDER_Z - drop - 2.5 }));
    parts.push({ depth: ab[2] + 0.3, draw: g => { g.fillStyle = look.armband!; g.fillRect(ab[0] - 1, ab[1] - 1, 2, 2); } });
  }

  // Arms
  let handR: V3 = { s: 0, u: 0, z: 0 };
  let foreR: V3 = { s: 0, u: 0, z: 0 };
  for (const side of [-1, 1] as const) {
    const ar = side < 0 ? p.armL : p.armR;
    const spread = side < 0 ? p.armSpreadL ?? 0.12 : p.armSpreadR ?? 0.12;
    const sh = leanPt({ s: 3.3 * side * build, u: 0, z: SHOULDER_Z - drop });
    // Arm angles are measured in the body's frame, so add the lean
    const [elb, hand] = limb(sh, ar[0] + p.lean, UPPER, ar[1], FORE, spread);
    const sleeve = look.sleeve ?? look.coat ?? look.shirt;
    capsule(sh, elb, 1.35, sleeve);
    capsule(elb, hand, 1.2, look.gown ? look.skin : sleeve);
    const H = toScreen(hand);
    parts.push({ depth: H[2] + 0.1, draw: g => ellipse(g, H[0], H[1], 1.3, 1.3, look.skin) });
    if (side > 0) {
      handR = hand;
      foreR = elb;
    }
  }

  // Scarf and head
  const neck = leanPt({ s: 0, u: 0, z: SHOULDER_Z + 0.8 - drop });
  if (look.scarf) {
    const N = toScreen(neck);
    parts.push({ depth: N[2] + 0.2, draw: g => ellipse(g, N[0], N[1], 3.4 * build, 1.8, look.scarf!) });
  }
  const head = leanPt({ s: 0, u: 0.2, z: HEAD_Z - drop });
  const Hd = toScreen(head);
  parts.push({
    depth: Hd[2] + 0.05,
    draw: g => {
      ellipse(g, Hd[0], Hd[1], 3.4, 3.5, look.skin);
      ellipse(g, Hd[0] - 0.8, Hd[1] - 1, 1.6, 1.6, shade(look.skin, 0.12));
      // Hair covers the back and top of the head
      if (look.hairStyle !== 'bald') {
        const bx = Hd[0] - fx * 1.6;
        const by = Hd[1] - fy * 0.8 - 1.4;
        ellipse(g, bx, by, 3.3, look.hairStyle === 'shaggy' ? 3.0 : 2.5, look.hair);
        if (look.hairStyle === 'long' || look.hairStyle === 'shaggy') {
          const bx2 = Hd[0] - fx * 2.2;
          const by2 = Hd[1] - fy * 1.1 + 1.5;
          ellipse(g, bx2, by2, 2.6, 2.6, look.hair);
        }
        if (look.hairStyle === 'tied') ellipse(g, Hd[0] - fx * 3.4, Hd[1] - fy * 1.7 - 0.5, 1.4, 1.4, look.hair);
      }
      // Face: eyes when facing the viewer at all
      if (fy > -0.35) {
        const ex = Hd[0] + fx * 1.8;
        const ey = Hd[1] + 0.2;
        const eye = look.eyes ?? '#1b1714';
        const sx = rx * 1.3;
        g.fillStyle = eye;
        if (Math.abs(fx) < 0.8) {
          g.fillRect(Math.round(ex - sx), Math.round(ey), 1, 1);
          g.fillRect(Math.round(ex + sx), Math.round(ey), 1, 1);
        } else {
          g.fillRect(Math.round(ex + fx * 0.6), Math.round(ey), 1, 1);
        }
      }
      // Hats
      if (look.hat) {
        const hc = look.hatColour ?? '#4a3c2c';
        if (look.hat === 'brim') {
          ellipse(g, Hd[0], Hd[1] - 2.2, 5.6, 2.2, shade(hc, -0.15));
          ellipse(g, Hd[0], Hd[1] - 3.6, 3.2, 2.2, hc);
        } else if (look.hat === 'cap') {
          ellipse(g, Hd[0], Hd[1] - 2.4, 3.5, 2.2, hc);
          ellipse(g, Hd[0] + fx * 3, Hd[1] - 2 + fy * 1.2, 2.2, 1.0, shade(hc, -0.2));
        } else {
          ellipse(g, Hd[0], Hd[1] - 2.0, 3.6, 2.6, hc);
        }
      }
    }
  });

  // Tool in the right hand
  if (tool !== 'none' && anim !== 'dead' && anim !== 'roll' && anim !== 'hurt') {
    const H = toScreen(handR);
    const E = toScreen(foreR);
    // Direction along the forearm, then tilted
    let dx = H[0] - E[0];
    let dy = H[1] - E[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const t = p.toolTilt * (fx >= 0 ? 1 : -1) * (anim === 'swing' ? 1 : 0.6);
    const cx = dx * Math.cos(t) - dy * Math.sin(t);
    const cy = dx * Math.sin(t) + dy * Math.cos(t);
    const depth = H[2] + (fy >= 0 ? 0.6 : -0.6);
    parts.push({ depth, draw: g => drawTool(g, tool, H[0], H[1], cx, cy) });
  }

  parts.sort((x, y) => x.depth - y.depth);
  for (const part of parts) part.draw(ctx);
  crisp(cv);
  outline(cv, undefined, 0.68);
  return cv;
}

function drawTool(g: CanvasRenderingContext2D, tool: Tool, x: number, y: number, dx: number, dy: number): void {
  const handle = '#7a5a3a';
  const steel = '#a8adb2';
  const at = (k: number): [number, number] => [x + dx * k, y + dy * k];
  switch (tool) {
    case 'hoe': {
      const [ex, ey] = at(10);
      line(g, x - dx * 3, y - dy * 3, ex, ey, 1, handle);
      line(g, ex, ey, ex - dy * 3, ey + dx * 3, 2, '#6f7376');
      break;
    }
    case 'axe': {
      const [ex, ey] = at(9);
      line(g, x - dx * 2, y - dy * 2, ex, ey, 1.2, handle);
      line(g, ex - dy * 1, ey + dx * 1, ex - dy * 3.5, ey + dx * 3.5, 3, steel);
      break;
    }
    case 'pick': {
      const [ex, ey] = at(9);
      line(g, x - dx * 2, y - dy * 2, ex, ey, 1.2, handle);
      line(g, ex + dy * 3.5, ey - dx * 3.5, ex - dy * 3.5, ey + dx * 3.5, 1.6, '#8a8f94');
      break;
    }
    case 'machete': {
      const [ex, ey] = at(10);
      line(g, x - dx * 1.5, y - dy * 1.5, x + dx * 2, y + dy * 2, 1.6, '#2e2620');
      line(g, x + dx * 2, y + dy * 2, ex, ey, 1.8, steel);
      break;
    }
    case 'can': {
      const [ex, ey] = at(3);
      g.fillStyle = '#5f7a86';
      g.fillRect(Math.round(ex - 3), Math.round(ey - 2), 6, 4);
      g.fillStyle = '#7f9aa6';
      g.fillRect(Math.round(ex - 3), Math.round(ey - 2), 6, 1);
      line(g, ex + dx * 3, ey + dy * 3, ex + dx * 6, ey + dy * 6, 1, '#5f7a86');
      break;
    }
    case 'pistol': {
      const [ex, ey] = at(4.5);
      line(g, x, y, ex, ey, 2, '#2a2c2e');
      line(g, x - dy * 0.5, y + dx * 0.5, x + dy * 1.5, y - dx * 1.5 + 1.5, 1.4, '#4a3a2c');
      break;
    }
  }
}

// ---------------------------------------------------------------- looks

export const LOOKS: Record<string, Look> = {
  player: {
    id: 'player', skin: '#c99872', hair: '#3a2a20', hairStyle: 'short', shirt: '#8a7e62', coat: '#5d5536',
    pants: '#3f4448', boots: '#2e2620', scarf: '#7a3a2c'
  },
  husk: {
    id: 'husk', skin: '#9aa58e', hair: '#4a4a40', hairStyle: 'shaggy', shirt: '#7f8f96', sleeve: '#7f8f96',
    pants: '#5f6a6e', boots: '#6f6a5a', hunch: 0.38, reach: 0.65, eyes: '#2a0f0c', gown: true
  },
  raider: {
    id: 'raider', skin: '#b8865e', hair: '#1e1612', hairStyle: 'bald', shirt: '#4a3a2e', coat: '#2e2620', sleeve: '#3a2e26',
    pants: '#2f302c', boots: '#1e1a16', scarf: '#8a2a22', hat: 'beanie', hatColour: '#2a2420', build: 1.08
  },
  envoy: {
    id: 'envoy', skin: '#c49a76', hair: '#5a4a3a', hairStyle: 'tied', shirt: '#6a5e4e', coat: '#2a2622',
    pants: '#2f302c', boots: '#1e1a16', scarf: '#8a2a22', hat: 'brim', hatColour: '#1e1a16'
  },
  trader: {
    id: 'trader', skin: '#a8724e', hair: '#1e1612', hairStyle: 'tied', shirt: '#c8b890', coat: '#2f5a5a',
    pants: '#3a3a36', boots: '#2a221c', armband: '#e0782a', hat: 'cap', hatColour: '#2a4444'
  }
};

const HAND_SKINS = ['#d2a07a', '#8a5a3a', '#b98760', '#6a442c', '#e0b090'];
const HAND_HAIR = ['#2a1e16', '#6a4a2a', '#1a1412', '#8a7a5a', '#3a2a20'];
const HAND_SHIRTS = ['#6a7a5a', '#7a5a4a', '#5a6a7a', '#8a7a4a', '#6a5a6a'];
const HAND_STYLES: Look['hairStyle'][] = ['tied', 'short', 'long', 'shaggy', 'short'];

export function handLook(i: number, id: string): Look {
  return {
    id: 'hand_' + id,
    skin: HAND_SKINS[i % 5],
    hair: HAND_HAIR[(i + 2) % 5],
    hairStyle: HAND_STYLES[i % 5],
    shirt: HAND_SHIRTS[i % 5],
    pants: ['#4a4438', '#3f4448', '#5a4a3a'][i % 3],
    boots: '#2e2620',
    hat: i % 2 === 0 ? 'brim' : undefined,
    hatColour: '#6a5a3a'
  };
}

const ANIM_TOOLS: Partial<Record<Anim, Tool[]>> = {
  swing: ['hoe', 'axe', 'pick', 'machete', 'none'],
  pour: ['can'],
  shoot: ['pistol']
};

export function frameName(look: string, anim: Anim, dir: number, frame: number, tool: Tool = 'none'): string {
  return `ch:${look}:${anim}:${tool}:${dir}:${frame}`;
}

/** Paint every frame a character needs into the atlas queue. */
export function paintCharacterSet(atlas: Atlas, look: Look, anims: Anim[]): void {
  for (const anim of anims) {
    const tools = ANIM_TOOLS[anim] ?? ['none'];
    for (const tool of tools)
      for (let dir = 0; dir < 8; dir++)
        for (let f = 0; f < FRAMES[anim]; f++) {
          const name = frameName(look.id, anim, dir, f, tool);
          if (atlas.has(name)) continue;
          atlas.add(name, paintCharacter(look, anim, f, dir, tool), 22, 40);
        }
  }
}

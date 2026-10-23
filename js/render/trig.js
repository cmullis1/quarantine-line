// Sine and cosine of one angle together, for the crowd's poses: sincos(x) leaves sin x in SC[0] and cos x in SC[1].
// A pose takes a dozen angles, and Math.sin and Math.cos are a call each; this is fdlibm's reduction by π/2 and its
// double-precision kernels (what those calls run), done once for both.
export const SC = new Float64Array(2);
const PIO2_1 = 1.57079632673412561417, PIO2_1T = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-01;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
export function sincos(x) {
  // PIO2_1 holds π/2's first 33 bits, so n × PIO2_1 is exact while |n| < 2^20 (angles up to ~1.6 million).
  const n = Math.round(x * INV_PIO2);
  const r = (x - n * PIO2_1) - n * PIO2_1T, z = r * r;
  const sn = r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
  const cs = 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  switch (n & 3) {
    case 0: SC[0] = sn; SC[1] = cs; break;
    case 1: SC[0] = cs; SC[1] = -sn; break;
    case 2: SC[0] = -sn; SC[1] = -cs; break;
    default: SC[0] = -cs; SC[1] = sn;
  }
}

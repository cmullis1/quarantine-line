// Scene, isometric camera, lighting and day/night, pixel scale, shake, and screen↔world helpers.
import * as THREE from 'three';

const ELEV = Math.atan(1 / Math.SQRT2); // true isometric
const SHADOW_TEXEL = 80 / 2048; // the shadow camera's 80-unit square over its 2048 map

// Auto pixel size by zoom: 3 at the default zoom, 2 zoomed out past 1.0, 1 past 0.65, so zooming out sharpens.
const autoPixel = (zoom) => (zoom >= 1 ? 3 : zoom >= 0.65 ? 2 : 1);
const AUTO_BAND = 0.02; // a zoom this close to a threshold keeps the size it has, so a zoom resting there never flaps

export class View {
  constructor(canvas, N) {
    this.N = N;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.view = { x: N / 2, z: N / 2, yaw: Math.PI / 4, yawT: Math.PI / 4, zoom: 1.4, zoomT: 1.4 };
    this.pixelSetting = 0; // 0 Auto (by zoom), else a fixed 1–4
    this.pixel = 3; // the size in use
    this.shake = 0;
    this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._d = new THREE.Vector3(); this._c = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight(0xd8e8ff, 0x5a4a35, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.newScene(N);

    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this.colors = {
      daySky: new THREE.Color(0x151a1d), nightSky: new THREE.Color(0x0b0f18), rainSky: new THREE.Color(0x10141a),
      sunDay: new THREE.Color(0xfff1d6), sunDusk: new THREE.Color(0xffa060), sunNight: new THREE.Color(0x9aa6c8),
      hemiDay: new THREE.Color(0xd8e8ff), hemiNight: new THREE.Color(0xa0aac8), hemiRain: new THREE.Color(0x9aa8b8),
    };
    this.resize();
    this.watchDpr();
  }

  // A window moved to a monitor with another scale changes devicePixelRatio, often without a resize event.
  watchDpr() {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { this.resize(); this.watchDpr(); }, { once: true });
  }

  // Each game gets a fresh scene; the renderer and lights are reused.
  newScene(N) {
    this.N = N;
    // The old game's geometry, and the instance buffers of every batched mesh (crowd, trees, crops, walls), go with it.
    if (this.scene) this.scene.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); if (o.isInstancedMesh) o.dispose(); });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x151a1d);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.view = { x: N / 2, z: N / 2, yaw: Math.PI / 4, yawT: Math.PI / 4, zoom: 1.4, zoomT: 1.4 };
  }

  resize() { this.applySize(); this.updateCamera(); }

  // The low-res canvas: each render pixel is a whole number of physical pixels (`k`, the pixel size times the
  // display's scale, rounded), so the stretched picture has no uneven rows or columns; at 175% a 3 is 5 physical
  // pixels, not 5.25. The canvas covers the window and overhangs it by under one render pixel at the right and bottom.
  applySize() {
    const dpr = devicePixelRatio || 1, k = Math.max(1, Math.round(dpr * this.pixel));
    this.rw = Math.max(1, Math.ceil(Math.round(innerWidth * dpr) / k));
    this.rh = Math.max(1, Math.ceil(Math.round(innerHeight * dpr) / k));
    this.cssW = (this.rw * k) / dpr; this.cssH = (this.rh * k) / dpr;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.rw, this.rh, false);
    const st = this.renderer.domElement.style;
    st.width = `${this.cssW}px`; st.height = `${this.cssH}px`;
  }

  // 0 = Auto, 1–4 fixed; Auto → 1 → 2 → 3 → 4 → Auto.
  cyclePixel() { this.setPixel(this.pixelSetting >= 4 ? 0 : this.pixelSetting + 1); return this.pixelSetting; }
  setPixel(p) {
    this.pixelSetting = p;
    this.pixel = p || autoPixel(this.view.zoom);
    this.resize();
  }

  updateCamera() {
    const v = this.view, cam = this.cam;
    if (!this.pixelSetting) {
      const lo = autoPixel(v.zoom - AUTO_BAND), hi = autoPixel(v.zoom + AUTO_BAND);
      if (lo === hi && lo !== this.pixel) { this.pixel = lo; this.applySize(); }
    }
    // 30 units over the window's height at zoom 1; the canvas's overhang extends the view at the same scale.
    const h = ((30 / v.zoom) * this.cssH) / innerHeight, w = (h * this.rw) / this.rh;
    cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2;
    const D = 140;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sz = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    cam.position.set(v.x + sx + Math.sin(v.yaw) * Math.cos(ELEV) * D, Math.sin(ELEV) * D, v.z + sz + Math.cos(v.yaw) * Math.cos(ELEV) * D);
    cam.lookAt(v.x + sx, 0, v.z + sz);
    cam.updateMatrixWorld();
    // Snapped to the render-pixel grid in the camera's own right/up plane, so still scenery moves in whole render
    // pixels and does not crawl. view.x/z stay as they are (the pan and its tween); only what is drawn snaps, and
    // picking and projection use this same camera.
    const px = h / this.rh, R = this._r.setFromMatrixColumn(cam.matrixWorld, 0), U = this._u.setFromMatrixColumn(cam.matrixWorld, 1);
    const dr = cam.position.dot(R), du = cam.position.dot(U);
    cam.position.addScaledVector(R, Math.round(dr / px) * px - dr).addScaledVector(U, Math.round(du / px) * px - du);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // Daylight 0..1 from the hour; returns {day, dusk, night}.
  // `wet` 0–1: how far a rain shower has rolled in (dimmer, cooler, flatter light).
  lighting(hour, wet = 0) {
    const day = hour < 5 || hour > 21 ? 0 : hour < 8 ? (hour - 5) / 3 : hour > 18 ? (21 - hour) / 3 : 1;
    const dusk = 1 - Math.abs(day - 0.5) * 2;
    const ang = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const v = this.view, C = this.colors;
    // The shadow camera follows the view, snapped to its own texel grid across the light so shadow edges do not
    // shimmer while the camera pans.
    const off = this._d.set(Math.cos(ang) * 50, 60, 30 + Math.sin(ang) * 20), len = off.length();
    const R = this._r.set(0, 1, 0).cross(off).normalize(), U = this._u.crossVectors(off, R).divideScalar(len);
    const c = this._c.set(v.x, 0, v.z), cr = c.dot(R), cu = c.dot(U);
    c.addScaledVector(R, Math.round(cr / SHADOW_TEXEL) * SHADOW_TEXEL - cr).addScaledVector(U, Math.round(cu / SHADOW_TEXEL) * SHADOW_TEXEL - cu);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).add(off);
    this.sun.intensity = (1.25 + 1.25 * day) * (1 - 0.6 * wet);
    this.sun.color.copy(C.sunNight).lerp(C.sunDay, day).lerp(C.sunDusk, dusk * 0.6 * (1 - wet));
    this.hemi.intensity = (0.95 + 0.25 * day) * (1 - 0.3 * wet);
    this.hemi.color.copy(C.hemiNight).lerp(C.hemiDay, day).lerp(C.hemiRain, wet * day);
    this.scene.background.copy(C.nightSky).lerp(C.daySky, day).lerp(C.rainSky, wet * day);
    return { day, dusk, night: 1 - day };
  }

  // Morning fog: a depth haze that thickens toward the top of the screen. Rain adds a lighter grey curtain.
  setFog(amount, wet = 0) {
    amount = Math.max(amount, wet * 0.45);
    this.fogAmount = (this.fogAmount || 0) + (amount - (this.fogAmount || 0)) * 0.03;
    const a = this.fogAmount;
    if (a < 0.02) { this.scene.fog = null; return; }
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0xb8c0c4, 200, 400);
    this.scene.fog.color.copy(this.scene.background).lerp(new THREE.Color(0xc4cace), 0.7);
    this.scene.fog.near = 150 - 40 * a;
    this.scene.fog.far = 150 + 80 * (1.2 - a);
  }

  groundAt(sx, sy) {
    this._ndc.set((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
    this.ray.setFromCamera(this._ndc, this.cam);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  project(x, y, z) {
    this._v.set(x, y, z).project(this.cam);
    const sx = ((this._v.x + 1) / 2) * this.cssW, sy = ((1 - this._v.y) / 2) * this.cssH;
    return [sx, sy, sx > -60 && sx < innerWidth + 60 && sy > -40 && sy < innerHeight + 40];
  }

  // Ground quad the camera currently sees (for the minimap).
  viewPolygon() {
    const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => this.groundAt(x, y)).filter(Boolean);
    return pts.length === 4 ? pts.map((p) => [p.x, p.z]) : null;
  }

  render() { this.renderer.render(this.scene, this.cam); }
}

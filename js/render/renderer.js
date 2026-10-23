// Scene, isometric camera, lighting and day/night, pixel scale, shake, and screen↔world helpers.
import * as THREE from 'three';

const ELEV = Math.atan(1 / Math.SQRT2); // true isometric

export class View {
  constructor(canvas, N) {
    this.N = N;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.view = { x: N / 2, z: N / 2, yaw: Math.PI / 4, yawT: Math.PI / 4, zoom: 1.4, zoomT: 1.4 };
    this.pixel = 3;
    this.shake = 0;

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
  }

  // Each game gets a fresh scene; the renderer and lights are reused.
  newScene(N) {
    this.N = N;
    if (this.scene) this.scene.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x151a1d);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.view = { x: N / 2, z: N / 2, yaw: Math.PI / 4, yawT: Math.PI / 4, zoom: 1.4, zoomT: 1.4 };
  }

  resize() {
    this.renderer.setPixelRatio(1 / this.pixel);
    this.renderer.setSize(innerWidth, innerHeight);
    this.updateCamera();
  }

  cyclePixel() { this.pixel = this.pixel >= 4 ? 1 : this.pixel + 1; this.resize(); return this.pixel; }
  setPixel(p) { this.pixel = p; this.resize(); }

  updateCamera() {
    const v = this.view, cam = this.cam;
    const aspect = innerWidth / innerHeight;
    const h = 30 / v.zoom;
    cam.left = (-h * aspect) / 2; cam.right = (h * aspect) / 2; cam.top = h / 2; cam.bottom = -h / 2;
    const D = 140;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sz = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    cam.position.set(v.x + sx + Math.sin(v.yaw) * Math.cos(ELEV) * D, Math.sin(ELEV) * D, v.z + sz + Math.cos(v.yaw) * Math.cos(ELEV) * D);
    cam.lookAt(v.x + sx, 0, v.z + sz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // Keep the shadow camera centred on what we're looking at.
    this.sun.target.position.set(v.x, 0, v.z);
  }

  // Daylight 0..1 from the hour; returns {day, dusk, night}.
  // `wet` 0–1: how far a rain shower has rolled in (dimmer, cooler, flatter light).
  lighting(hour, wet = 0) {
    const day = hour < 5 || hour > 21 ? 0 : hour < 8 ? (hour - 5) / 3 : hour > 18 ? (21 - hour) / 3 : 1;
    const dusk = 1 - Math.abs(day - 0.5) * 2;
    const ang = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const v = this.view, C = this.colors;
    this.sun.position.set(v.x + Math.cos(ang) * 50, 60, v.z + 30 + Math.sin(ang) * 20);
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
    this._ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this._ndc, this.cam);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  project(x, y, z) {
    this._v.set(x, y, z).project(this.cam);
    const sx = ((this._v.x + 1) / 2) * innerWidth, sy = ((1 - this._v.y) / 2) * innerHeight;
    return [sx, sy, sx > -60 && sx < innerWidth + 60 && sy > -40 && sy < innerHeight + 40];
  }

  // Ground quad the camera currently sees (for the minimap).
  viewPolygon() {
    const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => this.groundAt(x, y)).filter(Boolean);
    return pts.length === 4 ? pts.map((p) => [p.x, p.z]) : null;
  }

  render() { this.renderer.render(this.scene, this.cam); }
}

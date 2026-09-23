import * as THREE from 'three';

/**
 * Orientación del teléfono (giroscopio) → mirada. Emite yaw / pitch en grados
 * relativos a la orientación con la que se activó. iOS pide permiso con un gesto.
 */
const zee = new THREE.Vector3(0, 0, 1);
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° en X
export class Gyro {
  constructor(onLook, log = console.log) {
    this.onLook = onLook; this.log = log;
    this.q = new THREE.Quaternion(); this.q0 = new THREE.Quaternion(); this.euler = new THREE.Euler();
    this.active = false; this.yaw0 = null;
    this.handler = (e) => this.onEvent(e);
  }

  async enable() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') { this.log('giroscopio: permiso denegado'); return false; }
      }
      window.addEventListener('deviceorientation', this.handler, true);
      this.active = true; this.yaw0 = null;
      this.log('giroscopio activo');
      return true;
    } catch (e) { this.log(`giroscopio: ${e.message}`); return false; }
  }

  disable() { window.removeEventListener('deviceorientation', this.handler, true); this.active = false; this.onLook(0, 0); }
  recenter() { this.yaw0 = null; }

  onEvent(e) {
    if (e.alpha == null) return;
    const alpha = THREE.MathUtils.degToRad(e.alpha), beta = THREE.MathUtils.degToRad(e.beta), gamma = THREE.MathUtils.degToRad(e.gamma);
    const orient = THREE.MathUtils.degToRad((screen.orientation?.angle ?? window.orientation) || 0);
    this.euler.set(beta, alpha, -gamma, 'YXZ');
    this.q.setFromEuler(this.euler).multiply(q1).multiply(this.q0.setFromAxisAngle(zee, -orient));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
    let yaw = Math.atan2(-fwd.x, -fwd.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    if (this.yaw0 === null) this.yaw0 = yaw;
    yaw = Math.atan2(Math.sin(yaw - this.yaw0), Math.cos(yaw - this.yaw0));
    this.onLook(THREE.MathUtils.radToDeg(yaw), THREE.MathUtils.radToDeg(pitch));
  }
}

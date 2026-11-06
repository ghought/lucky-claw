import * as THREE from 'three';
import { CLAW } from '../sim/config';
import type { Machine } from '../sim/machine';

const UP = new THREE.Vector3(0, 1, 0);

/** Chrome three-prong head, its linkage and the coiled feed cable. */
export class ClawModel {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private collar = new THREE.Group();
  private fingers: THREE.Group[] = [];
  private links: THREE.Mesh[] = [];
  private cord: THREE.Mesh;
  private cable: THREE.Mesh;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(scene: THREE.Scene, private machine: Machine) {
    const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.13 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da4, metalness: 1, roughness: 0.32 });
    const black = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.42 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.7 });

    // Solenoid housing, turned on a lathe.
    const profile = [
      [0, 0.024], [0.008, 0.024], [0.01, 0.012], [0.03, 0.006], [0.042, -0.006], [0.044, -0.02],
      [0.044, -0.05], [0.04, -0.056], [0.03, -0.062], [0.012, -0.066], [0, -0.066],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const housing = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), chrome);
    housing.castShadow = true;
    this.head.add(housing);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.012, 40), black);
    band.position.y = -0.03;
    this.head.add(band);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0028, 10, 20), steel);
    eye.position.y = 0.032;
    this.head.add(eye);

    // Sliding collar that the solenoid pulls to close the fingers.
    const collarMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 24), steel);
    this.collar.add(collarMesh);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.06, 12), chrome);
    rod.position.y = 0.03;
    this.collar.add(rod);
    this.head.add(this.collar);

    for (let i = 0; i < 3; i++) {
      const theta = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const rot = new THREE.Quaternion().setFromAxisAngle(UP, theta);
      const radial = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
      const point = (r: number, y: number) => radial.clone().multiplyScalar(r).add(new THREE.Vector3(0, y, 0));
      const pts = CLAW.fingerPath.map(([r, y]) => point(r, y));
      const finger = new THREE.Group();
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, CLAW.fingerRadius, 12, false), chrome);
      tube.castShadow = true;
      finger.add(tube);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(CLAW.tipRadius, 18, 14), rubber);
      tip.position.copy(pts[pts.length - 1]);
      tip.castShadow = true;
      finger.add(tip);
      // Hinge knuckle.
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.02, 16), steel);
      knuckle.quaternion.setFromUnitVectors(UP, axis);
      knuckle.castShadow = true;
      finger.add(knuckle);
      // Flat web stiffening the upper bend, as on stamped claws.
      const web = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.0035, 0.012),
        steel,
      );
      web.position.copy(point(0.024, -0.02));
      web.quaternion.copy(rot).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.72));
      finger.add(web);
      this.fingers.push(finger);
      this.group.add(finger);

      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 1, 10), steel);
      link.castShadow = true;
      this.links.push(link);
      this.group.add(link);
    }

    // Steel lift cable, and the coiled power cord around it.
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 8), new THREE.MeshStandardMaterial({ color: 0x31333a, metalness: 0.8, roughness: 0.45 }));
    this.cable.castShadow = true;
    this.group.add(this.cable);
    const turns = 34;
    const helix: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      helix.push(new THREE.Vector3(Math.cos(a) * 0.0105, i / (turns * 10) - 0.5, Math.sin(a) * 0.0105));
    }
    this.cord = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), turns * 10, 0.0017, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.4 }),
    );
    this.cord.castShadow = true;
    this.group.add(this.cord);

    this.group.add(this.head);
    scene.add(this.group);
  }

  private stretch(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
    const dir = this.b.copy(to).sub(from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.scale.set(1, len, 1);
  }

  update() {
    const m = this.machine;
    this.head.position.copy(m.hubPos);
    this.head.quaternion.copy(m.hubQuat);

    let mean = 0;
    m.fingers.forEach((f, i) => {
      const t = f.body.translation();
      const r = f.body.rotation();
      this.fingers[i].position.set(t.x, t.y, t.z);
      this.fingers[i].quaternion.set(r.x, r.y, r.z, r.w);
      mean += f.angle / 3;
    });
    const open = THREE.MathUtils.clamp(mean / CLAW.openAngle, 0, 1);
    this.collar.position.y = -0.074 - (1 - open) * -0.018;

    // Links run from the sliding collar out to a lug on each finger.
    const collarWorld = this.a;
    this.fingers.forEach((finger, i) => {
      const theta = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const rot = this.q.setFromAxisAngle(UP, theta);
      const lug = new THREE.Vector3(0.02, -0.018, 0).applyQuaternion(rot);
      lug.applyQuaternion(finger.quaternion).add(finger.position);
      collarWorld
        .set(0.012, this.collar.position.y, 0)
        .applyQuaternion(rot)
        .applyQuaternion(this.head.quaternion)
        .add(this.head.position);
      this.stretch(this.links[i], collarWorld.clone(), lug);
    });

    const top = new THREE.Vector3(m.trolley.x, CLAW.trolleyY, m.trolley.z);
    const eye = new THREE.Vector3(0, 0.03, 0).applyQuaternion(m.hubQuat).add(m.hubPos);
    this.stretch(this.cable, top, eye);
    this.stretch(this.cord, top, eye);
  }
}

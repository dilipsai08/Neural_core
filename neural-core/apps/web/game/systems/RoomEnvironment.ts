import * as THREE from "three";

export class RoomEnvironment {
  public sceneGroup: THREE.Group;
  private sporeParticles: THREE.Points | null = null;
  private flickeringLights: THREE.PointLight[] = [];
  private sporeCount = 1200;
  private sporePositions: Float32Array;

  constructor(scene: THREE.Scene) {
    this.sceneGroup = new THREE.Group();
    scene.add(this.sceneGroup);

    // Deep volumetric horror fog (Upside Down atmosphere)
    scene.fog = new THREE.FogExp2(0x080a0f, 0.04);

    this.sporePositions = new Float32Array(this.sporeCount * 3);
    this.buildBunkerRoom();
    this.buildPillarsAndVines();
    this.buildSpores();
    this.setupLighting(scene);
  }

  private buildBunkerRoom() {
    const roomSize = 40;
    const roomHeight = 7.5;

    // Floor (Dark industrial textured panels)
    const floorGeo = new THREE.PlaneGeometry(roomSize, roomSize, 20, 20);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f1318,
      roughness: 0.5,
      metalness: 0.6,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.sceneGroup.add(floor);

    // Ceiling with industrial beams
    const ceilGeo = new THREE.PlaneGeometry(roomSize, roomSize);
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x0b0d10,
      roughness: 0.8,
      metalness: 0.3,
    });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.y = roomHeight;
    ceil.rotation.x = Math.PI / 2;
    this.sceneGroup.add(ceil);

    // 4 Containment Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x141820,
      roughness: 0.7,
      metalness: 0.4,
    });

    // North Wall
    const northWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, roomHeight), wallMat);
    northWall.position.set(0, roomHeight / 2, -roomSize / 2);
    // South Wall
    const southWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, roomHeight), wallMat);
    southWall.position.set(0, roomHeight / 2, roomSize / 2);
    southWall.rotation.y = Math.PI;
    // East Wall
    const eastWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, roomHeight), wallMat);
    eastWall.position.set(roomSize / 2, roomHeight / 2, 0);
    eastWall.rotation.y = -Math.PI / 2;
    // West Wall
    const westWall = new THREE.Mesh(new THREE.PlaneGeometry(roomSize, roomHeight), wallMat);
    westWall.position.set(-roomSize / 2, roomHeight / 2, 0);
    westWall.rotation.y = Math.PI / 2;

    this.sceneGroup.add(northWall, southWall, eastWall, westWall);

    // Sealed Heavy Blast Doors & Broken Vents where monsters emerge
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1e232b,
      metalness: 0.9,
      roughness: 0.3,
    });
    const hazardMat = new THREE.MeshBasicMaterial({ color: 0xf2a43a });

    const doors = [
      { x: 0, z: -roomSize / 2 + 0.1, ry: 0 },
      { x: 0, z: roomSize / 2 - 0.1, ry: Math.PI },
      { x: roomSize / 2 - 0.1, z: 0, ry: -Math.PI / 2 },
      { x: -roomSize / 2 + 0.1, z: 0, ry: Math.PI / 2 },
    ];

    doors.forEach((d) => {
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 0.4), doorMat);
      doorMesh.position.set(d.x, 2.25, d.z);
      doorMesh.rotation.y = d.ry;

      // Caution stripes
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.25, 0.45), hazardMat);
      stripe.position.set(d.x, 4.4, d.z);
      stripe.rotation.y = d.ry;

      this.sceneGroup.add(doorMesh, stripe);
    });
  }

  private buildPillarsAndVines() {
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x111418,
      metalness: 0.7,
      roughness: 0.3,
    });
    const vineMat = new THREE.MeshStandardMaterial({
      color: 0x220509,
      roughness: 0.9,
      emissive: 0x3d0710,
      emissiveIntensity: 0.4,
    });

    const positions = [
      { x: -9, z: -9 },
      { x: 9, z: -9 },
      { x: -9, z: 9 },
      { x: 9, z: 9 },
    ];

    positions.forEach((p) => {
      // Concrete support pillar
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7.5, 1.6), pillarMat);
      pillar.position.set(p.x, 3.75, p.z);
      this.sceneGroup.add(pillar);

      // Organic Hawkins Lab / Upside Down tendril creeping up pillar
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 7.5, 8), vineMat);
      vine.position.set(p.x + 0.6, 3.75, p.z + 0.6);
      vine.rotation.z = 0.08;
      this.sceneGroup.add(vine);
    });
  }

  private buildSpores() {
    const geo = new THREE.BufferGeometry();
    for (let i = 0; i < this.sporeCount; i++) {
      this.sporePositions[i * 3 + 0] = (Math.random() - 0.5) * 38;
      this.sporePositions[i * 3 + 1] = Math.random() * 7;
      this.sporePositions[i * 3 + 2] = (Math.random() - 0.5) * 38;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(this.sporePositions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xff4d6d,
      size: 0.08,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    this.sporeParticles = new THREE.Points(geo, mat);
    this.sceneGroup.add(this.sporeParticles);
  }

  private setupLighting(scene: THREE.Scene) {
    // Eerie ambient baseline
    const ambient = new THREE.AmbientLight(0x0c1219, 1.2);
    scene.add(ambient);

    // Central containment overhead lamp
    const centerLight = new THREE.PointLight(0x3fd6c0, 2.5, 26);
    centerLight.position.set(0, 6.8, 0);
    this.sceneGroup.add(centerLight);
    this.flickeringLights.push(centerLight);

    // Red alert beacon
    const alarmLight = new THREE.PointLight(0xe5584a, 3.0, 24);
    alarmLight.position.set(-14, 6, -14);
    this.sceneGroup.add(alarmLight);
    this.flickeringLights.push(alarmLight);

    // Cyan secondary light
    const cyanLight = new THREE.PointLight(0x7d8cff, 2.0, 22);
    cyanLight.position.set(14, 6, 14);
    this.sceneGroup.add(cyanLight);
    this.flickeringLights.push(cyanLight);
  }

  public update(delta: number) {
    // Animate floating Upside Down spores
    if (this.sporeParticles) {
      const positions = this.sporeParticles.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < this.sporeCount; i++) {
        positions[i * 3 + 1] -= delta * 0.4; // Drift downwards
        positions[i * 3 + 0] += Math.sin(positions[i * 3 + 1] + i) * 0.01;

        if (positions[i * 3 + 1] < 0) {
          positions[i * 3 + 1] = 7;
        }
      }
      this.sporeParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Occasional horror electrical flicker
    if (Math.random() < 0.08) {
      const light = this.flickeringLights[Math.floor(Math.random() * this.flickeringLights.length)]!;
      light.intensity = Math.random() < 0.3 ? 0.3 : 2.5;
    }
  }
}

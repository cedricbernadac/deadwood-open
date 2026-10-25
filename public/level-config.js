import { LEVEL_ID } from './level-id.js';
// Shared metre coordinates. Blender dressing is fitted to these collision volumes.
// One level per process keeps the simulation and navigation caches immutable.
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const LEVELS = freeze({
  "cabin": {
    "id": "cabin",
    "name": "La cabane",
    "width": 16,
    "depth": 12,
    "halfWidth": 8,
    "halfDepth": 6,
    "wallHeight": 6.5,
    "buildingBounds": {
      "minX": -8,
      "maxX": 8,
      "minZ": -6,
      "maxZ": 6
    },
    "insideBounds": {
      "minX": -7.65,
      "maxX": 7.65,
      "minZ": -5.65,
      "maxZ": 5.65
    },
    "navigationBounds": {
      "minX": -7.54,
      "maxX": 7.54,
      "minZ": -5.54,
      "maxZ": 5.54
    },
    "companionBounds": {
      "minX": -7.45,
      "maxX": 7.45,
      "minZ": -5.45,
      "maxZ": 5.45
    },
    "loft": {
      "minX": 0.5,
      "maxX": 8,
      "minZ": -6,
      "maxZ": 6,
      "y": 3.4,
      "thickness": 0.24
    },
    "doors": [
      {
        "id": "north",
        "x": 0,
        "z": -6,
        "outX": 0,
        "outZ": -1
      },
      {
        "id": "south",
        "x": 0,
        "z": 6,
        "outX": 0,
        "outZ": 1
      },
      {
        "id": "west",
        "x": -8,
        "z": 0,
        "outX": -1,
        "outZ": 0
      },
      {
        "id": "east",
        "x": 8,
        "z": 0,
        "outX": 1,
        "outZ": 0
      }
    ],
    "interiorWalls": [],
    "furniture": [],
    "sofa": {
      "id": "sofa",
      "minX": -6,
      "maxX": -3.2,
      "minZ": 2.4,
      "maxZ": 3.5,
      "height": 0.8,
      "parts": [
        {
          "id": "sofa",
          "part": "seat",
          "minX": -5.7,
          "maxX": -3.5,
          "minZ": 2.4,
          "maxZ": 3.2,
          "height": 0.48
        },
        {
          "id": "sofa",
          "part": "back",
          "minX": -6,
          "maxX": -3.2,
          "minZ": 3.2,
          "maxZ": 3.5,
          "height": 0.8
        },
        {
          "id": "sofa",
          "part": "arm-west",
          "minX": -6,
          "maxX": -5.7,
          "minZ": 2.4,
          "maxZ": 3.2,
          "height": 0.72
        },
        {
          "id": "sofa",
          "part": "arm-east",
          "minX": -3.5,
          "maxX": -3.2,
          "minZ": 2.4,
          "maxZ": 3.2,
          "height": 0.72
        }
      ]
    },
    "table": {
      "id": "table",
      "minX": -2,
      "maxX": 0.2,
      "minZ": -1,
      "maxZ": 0.2,
      "height": 0.8
    },
    "armoryPositions": {},
    "generator": {
      "x": -5.3,
      "y": 0,
      "z": -4.6
    },
    "lateSupplyPosition": {
      "x": -2.4,
      "y": 0,
      "z": -5.82,
      "facing": 0
    },
    "roof": {
      "kind": "pitched",
      "height": 7.32,
      "thickness": 0.24,
      "bounds": {
        "minX": -8.38,
        "maxX": 8.38,
        "minZ": -6.5,
        "maxZ": 6.5
      }
    },
    "loftRailHeight": 0.72,
    "loftRailTopBarY": 0.66
  },
  "supermarket": {
    "id": "supermarket",
    "name": "Le Dernier Panier",
    "width": 28,
    "depth": 22,
    "halfWidth": 14,
    "halfDepth": 11,
    "wallHeight": 6.5,
    "buildingBounds": {
      "minX": -14,
      "maxX": 14,
      "minZ": -11,
      "maxZ": 11
    },
    "insideBounds": {
      "minX": -13.65,
      "maxX": 13.65,
      "minZ": -10.65,
      "maxZ": 10.65
    },
    "navigationBounds": {
      "minX": -13.54,
      "maxX": 13.54,
      "minZ": -10.54,
      "maxZ": 10.54
    },
    "companionBounds": {
      "minX": -13.45,
      "maxX": 13.45,
      "minZ": -10.45,
      "maxZ": 10.45
    },
    "loft": {
      "minX": 1000,
      "maxX": 1000,
      "minZ": 1000,
      "maxZ": 1000,
      "y": 3.4,
      "thickness": 0.24
    },
    "doors": [
      {
        "id": "north",
        "x": 0,
        "z": -11,
        "outX": 0,
        "outZ": -1
      },
      {
        "id": "south",
        "x": 0,
        "z": 11,
        "outX": 0,
        "outZ": 1
      },
      {
        "id": "west",
        "x": -14,
        "z": 0,
        "outX": -1,
        "outZ": 0
      },
      {
        "id": "east",
        "x": 14,
        "z": 0,
        "outX": 1,
        "outZ": 0
      }
    ],
    "furniture": [
      {
        "id": "shelf-west-north-outer",
        "kind": "shelf",
        "axis": "z",
        "minX": -10.7,
        "maxX": -9.5,
        "minZ": -7,
        "maxZ": -3.6,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "shelf-west-north-inner",
        "kind": "shelf",
        "axis": "z",
        "minX": -6.6,
        "maxX": -5.4,
        "minZ": -7,
        "maxZ": -3.6,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "shelf-west-south-outer",
        "kind": "shelf",
        "axis": "z",
        "minX": -10.7,
        "maxX": -9.5,
        "minZ": 3.6,
        "maxZ": 7,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "shelf-west-south-inner",
        "kind": "shelf",
        "axis": "z",
        "minX": -6.6,
        "maxX": -5.4,
        "minZ": 3.6,
        "maxZ": 7,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "aisle-inner-north",
        "kind": "shelf",
        "axis": "z",
        "minX": -2.8,
        "maxX": -1.6,
        "minZ": -7,
        "maxZ": -3.6,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "aisle-inner-south",
        "kind": "shelf",
        "axis": "z",
        "minX": -2.8,
        "maxX": -1.6,
        "minZ": 3.6,
        "maxZ": 7,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "aisle-east-north",
        "kind": "shelf",
        "axis": "z",
        "minX": 6.3,
        "maxX": 7.5,
        "minZ": -7.4,
        "maxZ": -3.8,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "aisle-east-south",
        "kind": "shelf",
        "axis": "z",
        "minX": 6.3,
        "maxX": 7.5,
        "minZ": 3.8,
        "maxZ": 7.4,
        "baseY": 0,
        "height": 2.5
      },
      {
        "id": "cellar-stock-west",
        "kind": "stock",
        "axis": "z",
        "minX": 0.1,
        "maxX": 1.3,
        "minZ": -5.8,
        "maxZ": -2.3,
        "baseY": -3.4,
        "height": 2.5
      },
      {
        "id": "cellar-stock-center",
        "kind": "stock",
        "axis": "z",
        "minX": 6.6,
        "maxX": 7.8,
        "minZ": -5.8,
        "maxZ": -2.3,
        "baseY": -3.4,
        "height": 2.5
      },
      {
        "id": "cellar-stock-south",
        "kind": "stock",
        "axis": "x",
        "minX": 1,
        "maxX": 6.7,
        "minZ": 5.8,
        "maxZ": 7,
        "baseY": -3.4,
        "height": 2.5
      },
      {
        "id": "cellar-cold-room",
        "kind": "cold-room",
        "axis": "z",
        "minX": 10,
        "maxX": 12.5,
        "minZ": -8.7,
        "maxZ": -5.6,
        "baseY": -3.4,
        "height": 2.7
      },
      {
        "id": "terrace-planter-north",
        "kind": "planter",
        "axis": "z",
        "minX": 12.9,
        "maxX": 13.6,
        "minZ": -8,
        "maxZ": -4.5,
        "baseY": 0,
        "height": 0.7
      },
      {
        "id": "terrace-planter-south",
        "kind": "planter",
        "axis": "z",
        "minX": 8.5,
        "maxX": 9.1,
        "minZ": -7.5,
        "maxZ": -4.5,
        "baseY": 0,
        "height": 0.7
      },
      {
        "id": "checkout-02",
        "kind": "checkout",
        "minX": -8.8,
        "maxX": -7.95,
        "minZ": 8.1,
        "maxZ": 9.9,
        "height": 0.8
      },
      {
        "id": "checkout-03",
        "kind": "checkout",
        "minX": -6.75,
        "maxX": -5.9,
        "minZ": 8.1,
        "maxZ": 9.9,
        "height": 0.8
      }
    ],
    "sofa": {
      "id": "sofa",
      "minX": -12.3,
      "maxX": -9.5,
      "minZ": -9.7,
      "maxZ": -8.6,
      "height": 0.8,
      "parts": [
        {
          "id": "sofa",
          "part": "seat",
          "minX": -12,
          "maxX": -9.8,
          "minZ": -9.7,
          "maxZ": -8.899999999999999,
          "height": 0.48
        },
        {
          "id": "sofa",
          "part": "back",
          "minX": -12.3,
          "maxX": -9.5,
          "minZ": -8.899999999999999,
          "maxZ": -8.6,
          "height": 0.8
        },
        {
          "id": "sofa",
          "part": "arm-west",
          "minX": -12.3,
          "maxX": -12,
          "minZ": -9.7,
          "maxZ": -8.899999999999999,
          "height": 0.72
        },
        {
          "id": "sofa",
          "part": "arm-east",
          "minX": -9.8,
          "maxX": -9.5,
          "minZ": -9.7,
          "maxZ": -8.899999999999999,
          "height": 0.72
        }
      ]
    },
    "table": {
      "id": "table",
      "minX": -10.85,
      "maxX": -10.0,
      "minZ": 8.1,
      "maxZ": 9.9,
      "height": 0.8
    },
    "armoryPositions": {
      "pistol": {
        "x": -12.3,
        "y": 0,
        "z": 10.82
      },
      "shotgun": {
        "x": 7.7,
        "y": 0,
        "z": -9.65
      },
      "bat": {
        "x": -13.82,
        "y": 0,
        "z": -7.6
      },
      "smg": {
        "x": 7.7,
        "y": 0,
        "z": 9.65
      },
      "fireaxe": {
        "x": 4.8,
        "y": 0,
        "z": -10.79
      },
      "assault": {
        "x": 0.1,
        "y": -3.4,
        "z": -8.8
      },
      "hammer": {
        "x": 0.1,
        "y": -3.4,
        "z": 1.8
      },
      "rifle": {
        "x": -13.82,
        "y": 0,
        "z": -9.65
      },
      "katana": {
        "x": 6.6,
        "y": -3.4,
        "z": 9.82
      },
      "flamethrower": {
        "x": 3,
        "y": -3.4,
        "z": 9.82
      },
      "minigun": {
        "x": -13.82,
        "y": 0,
        "z": 9.65
      },
      "sniper": {
        "x": 12.82,
        "y": -3.4,
        "z": -2.8
      },
      "magnum": {
        "x": 12.82,
        "y": -3.4,
        "z": -9.2
      },
      "rocket": {
        "x": 12.82,
        "y": -3.4,
        "z": 0.2
      }
    },
    "generator": {
      "x": -2.8,
      "y": 0,
      "z": -8.6
    },
    "lateSupplyPosition": {
      "x": -2.4,
      "y": 0,
      "z": -10.82,
      "facing": 0
    },
    "roof": {
      "kind": "flat",
      "height": 6.5,
      "thickness": 0.24,
      "bounds": {
        "minX": -14.38,
        "maxX": 8.38,
        "minZ": -11.5,
        "maxZ": 11.5
      }
    },
    "spawnEntries": [
      {
        "id": "north-culvert",
        "doorId": "north",
        "x": -4.2,
        "z": -16.4,
        "kind": "culvert"
      },
      {
        "id": "north-woods",
        "doorId": "north",
        "x": 4.2,
        "z": -16.4,
        "kind": "woods"
      },
      {
        "id": "south-woods",
        "doorId": "south",
        "x": -4.2,
        "z": 16.4,
        "kind": "woods"
      },
      {
        "id": "south-culvert",
        "doorId": "south",
        "x": 4.2,
        "z": 16.4,
        "kind": "culvert"
      },
      {
        "id": "west-woods",
        "doorId": "west",
        "x": -19.4,
        "z": -3.6,
        "kind": "woods"
      },
      {
        "id": "west-culvert",
        "doorId": "west",
        "x": -19.4,
        "z": 3.6,
        "kind": "culvert"
      },
      {
        "id": "east-culvert",
        "doorId": "east",
        "x": 19.4,
        "z": -3.6,
        "kind": "culvert"
      },
      {
        "id": "east-woods",
        "doorId": "east",
        "x": 19.4,
        "z": 3.6,
        "kind": "woods"
      }
    ],
    "raidEntries": [
      {
        "id": "raid-north-a",
        "doorId": "north",
        "x": -5,
        "z": -33
      },
      {
        "id": "raid-north-b",
        "doorId": "north",
        "x": 5,
        "z": -33
      },
      {
        "id": "raid-south-a",
        "doorId": "south",
        "x": -5,
        "z": 33
      },
      {
        "id": "raid-south-b",
        "doorId": "south",
        "x": 5,
        "z": 33
      },
      {
        "id": "raid-west-a",
        "doorId": "west",
        "x": -36,
        "z": -5
      },
      {
        "id": "raid-west-b",
        "doorId": "west",
        "x": -36,
        "z": 5
      },
      {
        "id": "raid-east-a",
        "doorId": "east",
        "x": 36,
        "z": -5
      },
      {
        "id": "raid-east-b",
        "doorId": "east",
        "x": 36,
        "z": 5
      }
    ],
    "supplyCaches": [
      {
        "x": -22,
        "y": 0,
        "z": 10
      },
      {
        "x": 21,
        "y": 0,
        "z": -11
      },
      {
        "x": -20,
        "y": 0,
        "z": -12
      }
    ],
    "interiorWalls": [],
    "loftRailHeight": 0,
    "loftRailTopBarY": 0,
    "spaceId": "supermarket-depth",
    "minY": -3.4
  },
  "hospital": {
    "id": "hospital",
    "name": "L'Hôpital des Pins",
    "width": 40,
    "depth": 30,
    "halfWidth": 20,
    "halfDepth": 15,
    "wallHeight": 6.5,
    "buildingBounds": {
      "minX": -20,
      "maxX": 20,
      "minZ": -15,
      "maxZ": 15
    },
    "insideBounds": {
      "minX": -19.65,
      "maxX": 19.65,
      "minZ": -14.65,
      "maxZ": 14.65
    },
    "navigationBounds": {
      "minX": -19.54,
      "maxX": 19.54,
      "minZ": -14.54,
      "maxZ": 14.54
    },
    "companionBounds": {
      "minX": -19.45,
      "maxX": 19.45,
      "minZ": -14.45,
      "maxZ": 14.45
    },
    "loft": {
      "minX": 1000,
      "maxX": 1000,
      "minZ": 1000,
      "maxZ": 1000,
      "y": 3.4,
      "thickness": 0.24
    },
    "doors": [
      {
        "id": "north",
        "x": 0,
        "z": -15,
        "outX": 0,
        "outZ": -1
      },
      {
        "id": "south",
        "x": 0,
        "z": 15,
        "outX": 0,
        "outZ": 1
      },
      {
        "id": "west",
        "x": -20,
        "z": 0,
        "outX": -1,
        "outZ": 0
      },
      {
        "id": "east",
        "x": 20,
        "z": 0,
        "outX": 1,
        "outZ": 0
      }
    ],
    "furniture": [
      {
        "id": "reception-accueil-desk-return",
        "kind": "reception",
        "axis": "z",
        "minX": -9.2,
        "maxX": -7.95,
        "minZ": -10.35,
        "maxZ": -8.3,
        "baseY": 0,
        "height": 1.05
      },
      {
        "id": "waiting-chair-01",
        "kind": "waiting-chair",
        "minX": -12.4,
        "maxX": -9.2,
        "minZ": -7.6,
        "maxZ": -6.9,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "waiting-chair-02",
        "kind": "waiting-chair",
        "minX": -12.4,
        "maxX": -9.2,
        "minZ": -5.4,
        "maxZ": -4.7,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "waiting-chair-03",
        "kind": "waiting-chair",
        "minX": -7.6,
        "maxX": -4.4,
        "minZ": -5.4,
        "maxZ": -4.7,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "emergency-triage-gurney-01",
        "kind": "gurney",
        "axis": "z",
        "minX": -16.55,
        "maxX": -15.45,
        "minZ": 6.2,
        "maxZ": 8.6,
        "baseY": 0,
        "height": 0.72
      },
      {
        "id": "emergency-triage-gurney-02",
        "kind": "gurney",
        "axis": "z",
        "minX": -12.55,
        "maxX": -11.45,
        "minZ": 6.2,
        "maxZ": 8.6,
        "baseY": 0,
        "height": 0.72
      },
      {
        "id": "emergency-triage-gurney-03",
        "kind": "gurney",
        "axis": "z",
        "minX": -8.55,
        "maxX": -7.45,
        "minZ": 6.2,
        "maxZ": 8.6,
        "baseY": 0,
        "height": 0.72
      },
      {
        "id": "emergency-triage-cabinet-01",
        "kind": "bedside-cabinet",
        "minX": -16.3,
        "maxX": -15.7,
        "minZ": 9,
        "maxZ": 9.55,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "emergency-triage-cabinet-02",
        "kind": "bedside-cabinet",
        "minX": -12.3,
        "maxX": -11.7,
        "minZ": 9,
        "maxZ": 9.55,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "emergency-triage-cabinet-03",
        "kind": "bedside-cabinet",
        "minX": -8.3,
        "maxX": -7.7,
        "minZ": 9,
        "maxZ": 9.55,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "emergency-privacy-curtain-01",
        "kind": "privacy-curtain",
        "axis": "z",
        "minX": -14.06,
        "maxX": -13.94,
        "minZ": 6,
        "maxZ": 9.4,
        "baseY": 0,
        "height": 2.1
      },
      {
        "id": "emergency-privacy-curtain-02",
        "kind": "privacy-curtain",
        "axis": "z",
        "minX": -10.06,
        "maxX": -9.94,
        "minZ": 6,
        "maxZ": 9.4,
        "baseY": 0,
        "height": 2.1
      },
      {
        "id": "emergency-crash-cart",
        "kind": "crash-cart",
        "minX": -5.8,
        "maxX": -4.8,
        "minZ": 8.8,
        "maxZ": 9.7,
        "baseY": 0,
        "height": 0.8
      },
      {
        "id": "ward-bed-01",
        "kind": "hospital-bed",
        "axis": "z",
        "minX": 3.85,
        "maxX": 5.25,
        "minZ": -14.6,
        "maxZ": -12.4,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bed-02",
        "kind": "hospital-bed",
        "axis": "z",
        "minX": 7.25,
        "maxX": 8.65,
        "minZ": -14.6,
        "maxZ": -12.4,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bed-03",
        "kind": "hospital-bed",
        "axis": "z",
        "minX": 3.85,
        "maxX": 5.25,
        "minZ": -9.7,
        "maxZ": -7.5,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bed-04",
        "kind": "hospital-bed",
        "axis": "z",
        "minX": 7.25,
        "maxX": 8.65,
        "minZ": -9.7,
        "maxZ": -7.5,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bedside-cabinet-01",
        "kind": "bedside-cabinet",
        "minX": 5.4,
        "maxX": 5.95,
        "minZ": -14.6,
        "maxZ": -14.05,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bedside-cabinet-02",
        "kind": "bedside-cabinet",
        "minX": 8.8,
        "maxX": 9.35,
        "minZ": -14.6,
        "maxZ": -14.05,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bedside-cabinet-03",
        "kind": "bedside-cabinet",
        "minX": 5.4,
        "maxX": 5.95,
        "minZ": -9.7,
        "maxZ": -9.15,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-bedside-cabinet-04",
        "kind": "bedside-cabinet",
        "minX": 8.8,
        "maxX": 9.35,
        "minZ": -9.7,
        "maxZ": -9.15,
        "baseY": 0,
        "height": 0.65
      },
      {
        "id": "ward-iv-stand-01",
        "kind": "iv-stand",
        "minX": 5.4,
        "maxX": 5.66,
        "minZ": -13.7,
        "maxZ": -13.44,
        "baseY": 0,
        "height": 1.65
      },
      {
        "id": "ward-iv-stand-02",
        "kind": "iv-stand",
        "minX": 8.8,
        "maxX": 9.06,
        "minZ": -13.7,
        "maxZ": -13.44,
        "baseY": 0,
        "height": 1.65
      },
      {
        "id": "ward-iv-stand-03",
        "kind": "iv-stand",
        "minX": 5.4,
        "maxX": 5.66,
        "minZ": -8.8,
        "maxZ": -8.54,
        "baseY": 0,
        "height": 1.65
      },
      {
        "id": "ward-iv-stand-04",
        "kind": "iv-stand",
        "minX": 8.8,
        "maxX": 9.06,
        "minZ": -8.8,
        "maxZ": -8.54,
        "baseY": 0,
        "height": 1.65
      },
      {
        "id": "ward-privacy-curtain-01",
        "kind": "privacy-curtain",
        "axis": "z",
        "minX": 6.54,
        "maxX": 6.66,
        "minZ": -14.6,
        "maxZ": -12.6,
        "baseY": 0,
        "height": 2.1
      },
      {
        "id": "ward-privacy-curtain-02",
        "kind": "privacy-curtain",
        "axis": "z",
        "minX": 6.54,
        "maxX": 6.66,
        "minZ": -9.7,
        "maxZ": -7.7,
        "baseY": 0,
        "height": 2.1
      },
      {
        "id": "ward-bed-head-console",
        "kind": "bed-head-console",
        "axis": "x",
        "minX": 3.75,
        "maxX": 9.35,
        "minZ": -9.95,
        "maxZ": -9.75,
        "baseY": 0,
        "height": 1.4
      },
      {
        "id": "nurses-station-desk",
        "kind": "nurses-station",
        "axis": "x",
        "minX": 3.8,
        "maxX": 8.4,
        "minZ": -5.2,
        "maxZ": -4,
        "baseY": 0,
        "height": 1.05
      },
      {
        "id": "operating-theatre-table",
        "kind": "operating-table",
        "axis": "z",
        "minX": 13.2,
        "maxX": 14.8,
        "minZ": -9.4,
        "maxZ": -7.2,
        "baseY": 0,
        "height": 0.78
      },
      {
        "id": "operating-anaesthesia-trolley",
        "kind": "anaesthesia-trolley",
        "minX": 15.6,
        "maxX": 16.6,
        "minZ": -9.3,
        "maxZ": -8.3,
        "baseY": 0,
        "height": 0.8
      },
      {
        "id": "operating-covered-tray-01",
        "kind": "covered-instrument-tray",
        "minX": 11.3,
        "maxX": 12.3,
        "minZ": -6.8,
        "maxZ": -5.9,
        "baseY": 0,
        "height": 0.78
      },
      {
        "id": "operating-covered-tray-02",
        "kind": "covered-instrument-tray",
        "minX": 16.1,
        "maxX": 17.1,
        "minZ": -6.8,
        "maxZ": -5.9,
        "baseY": 0,
        "height": 0.78
      },
      {
        "id": "operating-monitor-01",
        "kind": "monitor",
        "minX": 17.8,
        "maxX": 18.4,
        "minZ": -10.7,
        "maxZ": -10.1,
        "baseY": 0,
        "height": 1.45
      },
      {
        "id": "operating-monitor-02",
        "kind": "monitor",
        "minX": 11.2,
        "maxX": 11.8,
        "minZ": -10.7,
        "maxZ": -10.1,
        "baseY": 0,
        "height": 1.45
      },
      {
        "id": "operating-scrub-sink-01",
        "kind": "scrub-sink",
        "axis": "x",
        "minX": 11.5,
        "maxX": 13,
        "minZ": -13.8,
        "maxZ": -13.15,
        "baseY": 0,
        "height": 0.8
      },
      {
        "id": "operating-scrub-sink-02",
        "kind": "scrub-sink",
        "axis": "x",
        "minX": 14,
        "maxX": 15.5,
        "minZ": -13.8,
        "maxZ": -13.15,
        "baseY": 0,
        "height": 0.8
      },
      {
        "id": "operating-swinging-door-west",
        "kind": "swinging-door",
        "axis": "z",
        "minX": 13.08,
        "maxX": 13.2,
        "minZ": -4.13,
        "maxZ": -2.93,
        "baseY": 0,
        "height": 2.2
      },
      {
        "id": "operating-swinging-door-east",
        "kind": "swinging-door",
        "axis": "z",
        "minX": 15.6,
        "maxX": 15.72,
        "minZ": -4.13,
        "maxZ": -2.93,
        "baseY": 0,
        "height": 2.2
      },
      {
        "id": "chapel-bench-01",
        "kind": "chapel-bench",
        "axis": "x",
        "minX": 3.8,
        "maxX": 7.8,
        "minZ": 6.2,
        "maxZ": 7,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "chapel-bench-02",
        "kind": "chapel-bench",
        "axis": "x",
        "minX": 3.8,
        "maxX": 7.8,
        "minZ": 8.4,
        "maxZ": 9.2,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "chapel-altar",
        "kind": "chapel-altar",
        "axis": "x",
        "minX": 4.8,
        "maxX": 6.8,
        "minZ": 10.5,
        "maxZ": 11.2,
        "baseY": 0,
        "height": 1.12
      },
      {
        "id": "pharmacy-shelf-west",
        "kind": "pharmacy-shelf",
        "axis": "z",
        "minX": -11.5,
        "maxX": -10.3,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pharmacy-shelf-center",
        "kind": "pharmacy-shelf",
        "axis": "z",
        "minX": -7.9,
        "maxX": -6.7,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pharmacy-shelf-east",
        "kind": "pharmacy-shelf",
        "axis": "z",
        "minX": -4.9,
        "maxX": -3.7,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pharmacy-counter",
        "kind": "pharmacy-counter",
        "axis": "x",
        "minX": -10.5,
        "maxX": -6,
        "minZ": -4.8,
        "maxZ": -3.8,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "linen-shelf-west",
        "kind": "linen-shelf",
        "axis": "x",
        "minX": -11.5,
        "maxX": -7.5,
        "minZ": 11.3,
        "maxZ": 12.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "linen-shelf-east",
        "kind": "linen-shelf",
        "axis": "x",
        "minX": -6.5,
        "maxX": -3.5,
        "minZ": 11.3,
        "maxZ": 12.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "linen-cart-01",
        "kind": "linen-cart",
        "minX": -10.8,
        "maxX": -9.8,
        "minZ": 6.2,
        "maxZ": 7.2,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "linen-cart-02",
        "kind": "linen-cart",
        "minX": -6.5,
        "maxX": -5.5,
        "minZ": 8.3,
        "maxZ": 9.3,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "boiler-01",
        "kind": "boiler",
        "minX": 4.2,
        "maxX": 6.2,
        "minZ": 9.5,
        "maxZ": 11.5,
        "baseY": -3.4,
        "height": 2.4
      },
      {
        "id": "boiler-02",
        "kind": "boiler",
        "minX": 7.2,
        "maxX": 9.2,
        "minZ": 9.5,
        "maxZ": 11.5,
        "baseY": -3.4,
        "height": 2.4
      },
      {
        "id": "boiler-manifold",
        "kind": "boiler-manifold",
        "axis": "z",
        "minX": 10.3,
        "maxX": 11.1,
        "minZ": 7,
        "maxZ": 10.5,
        "baseY": -3.4,
        "height": 1.8
      },
      {
        "id": "boiler-workbench",
        "kind": "workbench",
        "axis": "x",
        "minX": 4.2,
        "maxX": 8.2,
        "minZ": 6,
        "maxZ": 6.8,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "archives-shelf-west",
        "kind": "archive-shelf",
        "axis": "z",
        "minX": 3.2,
        "maxX": 4.4,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "archives-shelf-center",
        "kind": "archive-shelf",
        "axis": "z",
        "minX": 7,
        "maxX": 8.2,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "archives-shelf-east",
        "kind": "archive-shelf",
        "axis": "z",
        "minX": 10.8,
        "maxX": 12,
        "minZ": -11.5,
        "maxZ": -6.5,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "archives-reading-table",
        "kind": "archive-table",
        "axis": "x",
        "minX": 5.2,
        "maxX": 9.2,
        "minZ": -4.8,
        "maxZ": -3.8,
        "baseY": -3.4,
        "height": 0.75
      },
      {
        "id": "archives-file-boxes",
        "kind": "archive-boxes",
        "minX": 10.5,
        "maxX": 11.7,
        "minZ": -5.5,
        "maxZ": -4.3,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "pass3-linen-shelf-west",
        "kind": "linen-shelf",
        "axis": "z",
        "minX": -18.95,
        "maxX": -17.75,
        "minZ": 4,
        "maxZ": 8,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-linen-shelf-north",
        "kind": "linen-shelf",
        "axis": "x",
        "minX": -16.8,
        "maxX": -13.8,
        "minZ": 2.74,
        "maxZ": 3.94,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-linen-cart-01",
        "kind": "linen-cart",
        "minX": -12.8,
        "maxX": -11.8,
        "minZ": 4.1,
        "maxZ": 5.1,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "pass3-linen-cart-02",
        "kind": "linen-cart",
        "minX": -3.8,
        "maxX": -2.8,
        "minZ": 7.2,
        "maxZ": 8.2,
        "baseY": -3.4,
        "height": 0.8
      },
      {
        "id": "pass3-linen-folding-table",
        "kind": "linen-folding-table",
        "axis": "x",
        "minX": -14.2,
        "maxX": -11.2,
        "minZ": 9.1,
        "maxZ": 10.1,
        "baseY": -3.4,
        "height": 0.92
      },
      {
        "id": "pass3-linen-laundry-bag-01",
        "kind": "laundry-bag",
        "minX": -18.86,
        "maxX": -18.12,
        "minZ": 13.1,
        "maxZ": 13.84,
        "baseY": -3.4,
        "height": 0.9
      },
      {
        "id": "pass3-linen-laundry-bag-02",
        "kind": "laundry-bag",
        "minX": -17.92,
        "maxX": -17.18,
        "minZ": 13.1,
        "maxZ": 13.84,
        "baseY": -3.4,
        "height": 1
      },
      {
        "id": "pass3-linen-laundry-bag-03",
        "kind": "laundry-bag",
        "minX": -3.56,
        "maxX": -2.82,
        "minZ": 13.04,
        "maxZ": 13.78,
        "baseY": -3.4,
        "height": 0.84
      },
      {
        "id": "pass3-archives-shelf-west",
        "kind": "archive-shelf",
        "axis": "z",
        "minX": 2.3,
        "maxX": 3.5,
        "minZ": -6.1,
        "maxZ": -3.25,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-archives-shelf-east",
        "kind": "archive-shelf",
        "axis": "z",
        "minX": 17.55,
        "maxX": 18.75,
        "minZ": -13.5,
        "maxZ": -9.4,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-archives-shelf-south",
        "kind": "archive-shelf",
        "axis": "x",
        "minX": 15,
        "maxX": 17.4,
        "minZ": -4,
        "maxZ": -2.9,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-archives-ladder",
        "kind": "archive-ladder",
        "axis": "z",
        "minX": 15.9,
        "maxX": 16.72,
        "minZ": -14,
        "maxZ": -13.22,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "pass3-chapel-bench-west",
        "kind": "chapel-bench",
        "axis": "x",
        "minX": 3,
        "maxX": 4.4,
        "minZ": 10,
        "maxZ": 10.8,
        "baseY": 0,
        "height": 0.92
      },
      {
        "id": "pass3-chapel-bench-east",
        "kind": "chapel-bench",
        "axis": "x",
        "minX": 7.2,
        "maxX": 8.4,
        "minZ": 10,
        "maxZ": 10.8,
        "baseY": 0,
        "height": 0.92
      },
      {
        "id": "pass3-chapel-lectern",
        "kind": "chapel-lectern",
        "axis": "x",
        "minX": 7.25,
        "maxX": 8.05,
        "minZ": 11.65,
        "maxZ": 12.45,
        "baseY": 0,
        "height": 1.18
      },
      {
        "id": "pass3-waiting-beam-row",
        "kind": "waiting-chair",
        "axis": "x",
        "minX": -19,
        "maxX": -15.8,
        "minZ": -14.45,
        "maxZ": -13.25,
        "baseY": 0,
        "height": 0.55
      },
      {
        "id": "pass3-waiting-water-cooler",
        "kind": "water-cooler",
        "minX": -14.72,
        "maxX": -14.12,
        "minZ": -14.55,
        "maxZ": -13.9,
        "baseY": 0,
        "height": 1.38
      },
      {
        "id": "pass3-waiting-kids-table",
        "kind": "kids-table",
        "minX": -19.35,
        "maxX": -18.15,
        "minZ": -4.55,
        "maxZ": -3.65,
        "baseY": 0,
        "height": 0.5
      },
      {
        "id": "pass3-waiting-kids-stool-east",
        "kind": "kids-stool",
        "minX": -18.09,
        "maxX": -17.65,
        "minZ": -5.25,
        "maxZ": -4.81,
        "baseY": 0,
        "height": 0.3
      },
      {
        "id": "pass3-waiting-kids-stool-south",
        "kind": "kids-stool",
        "minX": -18.55,
        "maxX": -18.11,
        "minZ": -3.45,
        "maxZ": -3.01,
        "baseY": 0,
        "height": 0.3
      },
      {
        "id": "pass3-waiting-kids-storage",
        "kind": "kids-storage",
        "minX": -19.8,
        "maxX": -19,
        "minZ": -3.45,
        "maxZ": -3,
        "baseY": 0,
        "height": 0.58
      }
    ],
    "sofa": {
      "id": "sofa",
      "minX": -12.3,
      "maxX": -9.5,
      "minZ": -13.5,
      "maxZ": -12.4,
      "height": 0.8,
      "parts": [
        {
          "id": "sofa",
          "part": "seat",
          "minX": -12,
          "maxX": -9.8,
          "minZ": -13.2,
          "maxZ": -12.4,
          "height": 0.48
        },
        {
          "id": "sofa",
          "part": "back",
          "minX": -12.3,
          "maxX": -9.5,
          "minZ": -13.5,
          "maxZ": -13.2,
          "height": 0.8
        },
        {
          "id": "sofa",
          "part": "arm-west",
          "minX": -12.3,
          "maxX": -12,
          "minZ": -13.2,
          "maxZ": -12.4,
          "height": 0.72
        },
        {
          "id": "sofa",
          "part": "arm-east",
          "minX": -9.8,
          "maxX": -9.5,
          "minZ": -13.2,
          "maxZ": -12.4,
          "height": 0.72
        }
      ]
    },
    "table": {
      "id": "table",
      "minX": -9.2,
      "maxX": -3.8,
      "minZ": -11.7,
      "maxZ": -10.45,
      "height": 0.8
    },
    "armoryPositions": {
      "pistol": {
        "x": -7.2,
        "y": 0,
        "z": 14.82,
        "facing": 3.141592653589793
      },
      "shotgun": {
        "x": 19.82,
        "y": 0,
        "z": -5.8,
        "facing": -1.5707963267948966
      },
      "bat": {
        "x": -19.82,
        "y": 0,
        "z": -11.2,
        "facing": 1.5707963267948966
      },
      "smg": {
        "x": 19.82,
        "y": 0,
        "z": 5.2,
        "facing": -1.5707963267948966
      },
      "fireaxe": {
        "x": 2.725,
        "y": 0,
        "z": -11.2,
        "facing": 1.5707963267948966
      },
      "assault": {
        "x": -7,
        "y": -3.4,
        "z": -13.82,
        "facing": 0
      },
      "hammer": {
        "x": 6,
        "y": -3.4,
        "z": -13.82,
        "facing": 0
      },
      "rifle": {
        "x": -19.82,
        "y": 0,
        "z": 5.8,
        "facing": 1.5707963267948966
      },
      "katana": {
        "x": -15.5,
        "y": -3.4,
        "z": 13.82,
        "facing": 3.141592653589793
      },
      "flamethrower": {
        "x": 0,
        "y": -3.4,
        "z": 13.82,
        "facing": 3.141592653589793
      },
      "minigun": {
        "x": -19.82,
        "y": 0,
        "z": -5.4,
        "facing": 1.5707963267948966
      },
      "sniper": {
        "x": 18.82,
        "y": -3.4,
        "z": -8,
        "facing": -1.5707963267948966
      },
      "magnum": {
        "x": 18.82,
        "y": -3.4,
        "z": -5,
        "facing": -1.5707963267948966
      },
      "rocket": {
        "x": 18.82,
        "y": -3.4,
        "z": 9.5,
        "facing": -1.5707963267948966
      }
    },
    "generator": {
      "x": -6.4,
      "y": 0,
      "z": -13.65
    },
    "lateSupplyPosition": {
      "x": -3.2,
      "y": 0,
      "z": -14.82,
      "facing": 0
    },
    "roof": {
      "kind": "flat",
      "height": 6.5,
      "thickness": 0.24,
      "bounds": {
        "minX": -20.38,
        "maxX": 20.38,
        "minZ": -15.5,
        "maxZ": 15.5
      }
    },
    "spawnEntries": [
      {
        "id": "north-culvert",
        "doorId": "north",
        "x": -4.2,
        "z": -20.4,
        "kind": "culvert"
      },
      {
        "id": "north-woods",
        "doorId": "north",
        "x": 4.2,
        "z": -20.4,
        "kind": "woods"
      },
      {
        "id": "south-woods",
        "doorId": "south",
        "x": -4.2,
        "z": 20.4,
        "kind": "woods"
      },
      {
        "id": "south-culvert",
        "doorId": "south",
        "x": 4.2,
        "z": 20.4,
        "kind": "culvert"
      },
      {
        "id": "west-woods",
        "doorId": "west",
        "x": -25.4,
        "z": -3.6,
        "kind": "woods"
      },
      {
        "id": "west-culvert",
        "doorId": "west",
        "x": -25.4,
        "z": 3.6,
        "kind": "culvert"
      },
      {
        "id": "east-culvert",
        "doorId": "east",
        "x": 25.4,
        "z": -3.6,
        "kind": "culvert"
      },
      {
        "id": "east-woods",
        "doorId": "east",
        "x": 25.4,
        "z": 3.6,
        "kind": "woods"
      }
    ],
    "raidEntries": [
      {
        "id": "raid-north-a",
        "doorId": "north",
        "x": -5,
        "z": -37
      },
      {
        "id": "raid-north-b",
        "doorId": "north",
        "x": 5,
        "z": -37
      },
      {
        "id": "raid-south-a",
        "doorId": "south",
        "x": -5,
        "z": 37
      },
      {
        "id": "raid-south-b",
        "doorId": "south",
        "x": 5,
        "z": 37
      },
      {
        "id": "raid-west-a",
        "doorId": "west",
        "x": -42,
        "z": -5
      },
      {
        "id": "raid-west-b",
        "doorId": "west",
        "x": -42,
        "z": 5
      },
      {
        "id": "raid-east-a",
        "doorId": "east",
        "x": 42,
        "z": -5
      },
      {
        "id": "raid-east-b",
        "doorId": "east",
        "x": 42,
        "z": 5
      }
    ],
    "supplyCaches": [
      {
        "x": -27,
        "y": 0,
        "z": 5
      },
      {
        "x": 26,
        "y": 0,
        "z": -8
      },
      {
        "x": -7,
        "y": 0,
        "z": -21
      }
    ],
    "interiorWalls": [],
    "loftRailHeight": 0,
    "loftRailTopBarY": 0,
    "spaceId": "hospital-depth",
    "minY": -3.4
  },
  "funfair": {
    "id": "funfair",
    "name": "La Fête Foraine",
    "width": 36,
    "depth": 26,
    "halfWidth": 18,
    "halfDepth": 13,
    "wallHeight": 6.5,
    "buildingBounds": {
      "minX": -18,
      "maxX": 18,
      "minZ": -13,
      "maxZ": 13
    },
    "insideBounds": {
      "minX": -17.65,
      "maxX": 17.65,
      "minZ": -12.65,
      "maxZ": 12.65
    },
    "navigationBounds": {
      "minX": -17.54,
      "maxX": 17.54,
      "minZ": -12.54,
      "maxZ": 12.54
    },
    "companionBounds": {
      "minX": -17.45,
      "maxX": 17.45,
      "minZ": -12.45,
      "maxZ": 12.45
    },
    "loft": {
      "minX": 1000,
      "maxX": 1000,
      "minZ": 1000,
      "maxZ": 1000,
      "y": 3.4,
      "thickness": 0.24
    },
    "doors": [
      {
        "id": "north",
        "x": 0,
        "z": -13,
        "outX": 0,
        "outZ": -1
      },
      {
        "id": "south",
        "x": 0,
        "z": 13,
        "outX": 0,
        "outZ": 1
      },
      {
        "id": "west",
        "x": -18,
        "z": 0,
        "outX": -1,
        "outZ": 0
      },
      {
        "id": "east",
        "x": 18,
        "z": 0,
        "outX": 1,
        "outZ": 0
      }
    ],
    "furniture": [
      {
        "id": "caisse-counter",
        "kind": "counter",
        "axis": "x",
        "minX": -10,
        "maxX": -4,
        "minZ": -6,
        "maxZ": -5.2,
        "baseY": 0,
        "height": 1.05
      },
      {
        "id": "caisse-kiddie-ride",
        "kind": "kiddie-ride",
        "axis": "z",
        "minX": -17.83,
        "maxX": -17.03,
        "minZ": -6.5,
        "maxZ": -5.3,
        "baseY": 0,
        "height": 1.25
      },
      {
        "id": "caisse-queue-rail",
        "kind": "queue-rail",
        "axis": "x",
        "minX": -10.4,
        "maxX": -7.6,
        "minZ": -4.2,
        "maxZ": -3.88,
        "baseY": 0,
        "height": 1
      },
      {
        "id": "jeux-arcade-row-north",
        "kind": "arcade-row",
        "axis": "x",
        "minX": 2.75,
        "maxX": 4.97,
        "minZ": -12.84,
        "maxZ": -11.99,
        "baseY": 0,
        "height": 1.95
      },
      {
        "id": "jeux-claw",
        "kind": "claw-machine",
        "axis": "x",
        "minX": 7,
        "maxX": 7.95,
        "minZ": -12.84,
        "maxZ": -11.89,
        "baseY": 0,
        "height": 2.05
      },
      {
        "id": "jeux-shelf",
        "kind": "prize-shelf",
        "axis": "z",
        "minX": 8.2,
        "maxX": 9.2,
        "minZ": -12.5,
        "maxZ": -9.6,
        "baseY": 0,
        "height": 2.2
      },
      {
        "id": "jeux-pinball-pair",
        "kind": "pinball",
        "axis": "z",
        "minX": 2.72,
        "maxX": 4.17,
        "minZ": -11.9,
        "maxZ": -10.35,
        "baseY": 0,
        "height": 1.9
      },
      {
        "id": "jeux-change-machine",
        "kind": "change-machine",
        "axis": "z",
        "minX": 2.72,
        "maxX": 3.2,
        "minZ": -10.25,
        "maxZ": -9.7,
        "baseY": 0,
        "height": 1.7
      },
      {
        "id": "jeux-arcade-row-south",
        "kind": "arcade-row",
        "axis": "x",
        "minX": 2.75,
        "maxX": 4.97,
        "minZ": -3.35,
        "maxZ": -2.5,
        "baseY": 0,
        "height": 1.95
      },
      {
        "id": "jeux-claw-pair",
        "kind": "claw-machine",
        "axis": "x",
        "minX": 7.05,
        "maxX": 9,
        "minZ": -3.4,
        "maxZ": -2.5,
        "baseY": 0,
        "height": 2.05
      },
      {
        "id": "jeux-skee-ball",
        "kind": "skee-ball",
        "axis": "z",
        "minX": 8.45,
        "maxX": 9.3,
        "minZ": -6.4,
        "maxZ": -3.6,
        "baseY": 0,
        "height": 1.2
      },
      {
        "id": "lots-counter",
        "kind": "counter",
        "axis": "x",
        "minX": 11,
        "maxX": 16,
        "minZ": -6,
        "maxZ": -5.2,
        "baseY": 0,
        "height": 1.05
      },
      {
        "id": "lots-prize-gondola",
        "kind": "prize-gondola",
        "axis": "x",
        "minX": 11,
        "maxX": 16,
        "minZ": -7.9,
        "maxZ": -7.2,
        "baseY": 0,
        "height": 2.2
      },
      {
        "id": "lots-prize-wall-north",
        "kind": "prize-wall",
        "axis": "x",
        "minX": 12,
        "maxX": 17.8,
        "minZ": -12.84,
        "maxZ": -12.2,
        "baseY": 0,
        "height": 2.6
      },
      {
        "id": "lots-prize-wall-east",
        "kind": "prize-wall",
        "axis": "z",
        "minX": 17.2,
        "maxX": 17.84,
        "minZ": -12.15,
        "maxZ": -9,
        "baseY": 0,
        "height": 2.4
      },
      {
        "id": "confiserie-counter",
        "kind": "counter",
        "axis": "x",
        "minX": -12,
        "maxX": -7,
        "minZ": 10.4,
        "maxZ": 11.2,
        "baseY": 0,
        "height": 1.05
      },
      {
        "id": "confiserie-backbar",
        "kind": "back-bar",
        "axis": "x",
        "minX": -14,
        "maxX": -7.2,
        "minZ": 12.2,
        "maxZ": 12.84,
        "baseY": 0,
        "height": 1
      },
      {
        "id": "confiserie-popcorn-cart",
        "kind": "snack-cart",
        "axis": "x",
        "minX": -16.4,
        "maxX": -15.4,
        "minZ": 11,
        "maxZ": 11.8,
        "baseY": 0,
        "height": 1.75
      },
      {
        "id": "confiserie-bistro-1",
        "kind": "bistro-table",
        "minX": -17.6,
        "maxX": -16.8,
        "minZ": 5.5,
        "maxZ": 6.3,
        "baseY": 0,
        "height": 1.45
      },
      {
        "id": "confiserie-bistro-2",
        "kind": "bistro-table",
        "minX": -17.6,
        "maxX": -16.8,
        "minZ": 7.8,
        "maxZ": 8.6,
        "baseY": 0,
        "height": 1.45
      },
      {
        "id": "confiserie-bistro-3",
        "kind": "bistro-table",
        "minX": -14.4,
        "maxX": -13.6,
        "minZ": 6.4,
        "maxZ": 7.2,
        "baseY": 0,
        "height": 1.45
      },
      {
        "id": "bumper-ticket-booth",
        "kind": "ticket-booth",
        "minX": 2.52,
        "maxX": 3.62,
        "minZ": 4.52,
        "maxZ": 5.52,
        "baseY": 0,
        "height": 2.4
      },
      {
        "id": "bumper-rail-north",
        "kind": "bumper-rail",
        "axis": "x",
        "minX": 3.5,
        "maxX": 9.5,
        "minZ": 6.5,
        "maxZ": 6.7,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-rail-south",
        "kind": "bumper-rail",
        "axis": "x",
        "minX": 3.5,
        "maxX": 9.5,
        "minZ": 11.8,
        "maxZ": 12,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-rail-west",
        "kind": "bumper-rail",
        "axis": "z",
        "minX": 3.5,
        "maxX": 3.7,
        "minZ": 6.5,
        "maxZ": 12,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-rail-east",
        "kind": "bumper-rail",
        "axis": "z",
        "minX": 9.3,
        "maxX": 9.5,
        "minZ": 6.5,
        "maxZ": 12,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-cars-row-north",
        "kind": "bumper-car",
        "minX": 3.74,
        "maxX": 9.26,
        "minZ": 6.74,
        "maxZ": 8.14,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-cars-row-south",
        "kind": "bumper-car",
        "minX": 3.74,
        "maxX": 9.26,
        "minZ": 10.36,
        "maxZ": 11.76,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-car-09",
        "kind": "bumper-car",
        "minX": 4.235,
        "maxX": 5.765,
        "minZ": 8.535,
        "maxZ": 9.965,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "bumper-car-10",
        "kind": "bumper-car",
        "minX": 6.83,
        "maxX": 8.37,
        "minZ": 8.505,
        "maxZ": 9.995,
        "baseY": 0,
        "height": 0.9
      },
      {
        "id": "tir-counter",
        "kind": "counter",
        "axis": "x",
        "minX": 4,
        "maxX": 14,
        "minZ": -4.2,
        "maxZ": -3.4,
        "baseY": -3.4,
        "height": 1.05
      },
      {
        "id": "tir-duck-stage",
        "kind": "duck-stage",
        "axis": "x",
        "minX": 4,
        "maxX": 14,
        "minZ": -11.95,
        "maxZ": -11.2,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "tir-prize-shelf",
        "kind": "prize-shelf",
        "axis": "z",
        "minX": 16.35,
        "maxX": 17,
        "minZ": -6.6,
        "maxZ": -2.55,
        "baseY": -3.4,
        "height": 2.2
      },
      {
        "id": "miroir-panel-01",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -15.5,
        "maxX": -13.7,
        "minZ": 4.85,
        "maxZ": 4.95,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-02",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -12.25,
        "maxX": -12.15,
        "minZ": 4,
        "maxZ": 5.8,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-03",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -10.7,
        "maxX": -8.9,
        "minZ": 4.85,
        "maxZ": 4.95,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-04",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -7.45,
        "maxX": -7.35,
        "minZ": 4,
        "maxZ": 5.8,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-05",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -5.9,
        "maxX": -4.1,
        "minZ": 4.85,
        "maxZ": 4.95,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-06",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -14.65,
        "maxX": -14.55,
        "minZ": 6.4,
        "maxZ": 8.2,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-07",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -13.1,
        "maxX": -11.3,
        "minZ": 7.25,
        "maxZ": 7.35,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-08",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -9.85,
        "maxX": -9.75,
        "minZ": 6.4,
        "maxZ": 8.2,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-09",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -8.3,
        "maxX": -6.5,
        "minZ": 7.25,
        "maxZ": 7.35,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-10",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -5.05,
        "maxX": -4.95,
        "minZ": 6.4,
        "maxZ": 8.2,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-11",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -15.5,
        "maxX": -13.7,
        "minZ": 9.65,
        "maxZ": 9.75,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-12",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -10.7,
        "maxX": -8.9,
        "minZ": 9.65,
        "maxZ": 9.75,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-13",
        "kind": "mirror-panel",
        "axis": "x",
        "minX": -5.9,
        "maxX": -4.1,
        "minZ": 9.65,
        "maxZ": 9.75,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "miroir-panel-14",
        "kind": "mirror-panel",
        "axis": "z",
        "minX": -7.45,
        "maxX": -7.35,
        "minZ": 8.5,
        "maxZ": 10.1,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "machines-switchboard",
        "kind": "switchboard",
        "axis": "z",
        "minX": 10.15,
        "maxX": 10.78,
        "minZ": 2.55,
        "maxZ": 6.95,
        "baseY": -3.4,
        "height": 2.3
      },
      {
        "id": "machines-transformer",
        "kind": "transformer",
        "minX": 3,
        "maxX": 4.4,
        "minZ": 5.6,
        "maxZ": 7,
        "baseY": -3.4,
        "height": 1.8
      },
      {
        "id": "machines-motor",
        "kind": "carousel-motor",
        "minX": 7.9,
        "maxX": 9.2,
        "minZ": 7.8,
        "maxZ": 9.3,
        "baseY": -3.4,
        "height": 1.4
      },
      {
        "id": "machines-cabinet-west",
        "kind": "electrical-cabinet",
        "axis": "z",
        "minX": 2.72,
        "maxX": 3.42,
        "minZ": 9.4,
        "maxZ": 11,
        "baseY": -3.4,
        "height": 1.75
      },
      {
        "id": "machines-workbench",
        "kind": "workbench",
        "axis": "x",
        "minX": 3.6,
        "maxX": 6.4,
        "minZ": 11.25,
        "maxZ": 11.98,
        "baseY": -3.4,
        "height": 0.95
      },
      {
        "id": "refuge-crates",
        "kind": "crate-stack",
        "minX": -16.95,
        "maxX": -14.9,
        "minZ": -5,
        "maxZ": -3.5,
        "baseY": -3.4,
        "height": 1.2
      },
      {
        "id": "refuge-horse-rack",
        "kind": "horse-rack",
        "axis": "z",
        "minX": -16.95,
        "maxX": -16.2,
        "minZ": -11.95,
        "maxZ": -10.05,
        "baseY": -3.4,
        "height": 1.9
      },
      {
        "id": "refuge-trunks",
        "kind": "trunks",
        "axis": "x",
        "minX": -12.6,
        "maxX": -11.2,
        "minZ": -11.95,
        "maxZ": -11.3,
        "baseY": -3.4,
        "height": 0.9
      }
    ],
    "sofa": {
      "id": "sofa",
      "minX": -16.3,
      "maxX": -13.5,
      "minZ": -12.4,
      "maxZ": -11.3,
      "height": 0.8,
      "parts": [
        {
          "id": "sofa",
          "part": "seat",
          "minX": -16,
          "maxX": -13.8,
          "minZ": -12.1,
          "maxZ": -11.3,
          "height": 0.48
        },
        {
          "id": "sofa",
          "part": "back",
          "minX": -16.3,
          "maxX": -13.5,
          "minZ": -12.4,
          "maxZ": -12.1,
          "height": 0.8
        },
        {
          "id": "sofa",
          "part": "arm-west",
          "minX": -16.3,
          "maxX": -16,
          "minZ": -12.1,
          "maxZ": -11.3,
          "height": 0.72
        },
        {
          "id": "sofa",
          "part": "arm-east",
          "minX": -13.8,
          "maxX": -13.5,
          "minZ": -12.1,
          "maxZ": -11.3,
          "height": 0.72
        }
      ]
    },
    "table": {
      "id": "table",
      "minX": 4.3,
      "maxX": 6.7,
      "minZ": -10.6,
      "maxZ": -9.4,
      "height": 0.8
    },
    "armoryPositions": {
      "pistol": {
        "x": -6,
        "y": 0,
        "z": 12.82,
        "facing": 3.141592653589793
      },
      "shotgun": {
        "x": -6,
        "y": 0,
        "z": -12.82,
        "facing": 0
      },
      "bat": {
        "x": -17.82,
        "y": 0,
        "z": -3.8,
        "facing": 1.5707963267948966
      },
      "smg": {
        "x": 17.82,
        "y": 0,
        "z": -3.8,
        "facing": -1.5707963267948966
      },
      "fireaxe": {
        "x": 6,
        "y": 0,
        "z": -12.82,
        "facing": 0
      },
      "assault": {
        "x": -8,
        "y": -3.4,
        "z": -11.82,
        "facing": 0
      },
      "hammer": {
        "x": 15.5,
        "y": -3.4,
        "z": -11.82,
        "facing": 0
      },
      "rifle": {
        "x": -17.82,
        "y": 0,
        "z": 3.4,
        "facing": 1.5707963267948966
      },
      "katana": {
        "x": -16.82,
        "y": -3.4,
        "z": 7,
        "facing": 1.5707963267948966
      },
      "flamethrower": {
        "x": -8,
        "y": -3.4,
        "z": 11.82,
        "facing": 3.141592653589793
      },
      "minigun": {
        "x": 15,
        "y": 0,
        "z": 12.82,
        "facing": 3.141592653589793
      },
      "sniper": {
        "x": 16.82,
        "y": -3.4,
        "z": -8,
        "facing": -1.5707963267948966
      },
      "magnum": {
        "x": 16.82,
        "y": -3.4,
        "z": 8,
        "facing": -1.5707963267948966
      },
      "rocket": {
        "x": 8,
        "y": -3.4,
        "z": 11.82,
        "facing": 3.141592653589793
      }
    },
    "generator": {
      "x": 6,
      "y": -3.4,
      "z": 9
    },
    "lateSupplyPosition": {
      "x": -4,
      "y": 0,
      "z": -12.82,
      "facing": 0
    },
    "roof": {
      "kind": "flat",
      "height": 6.5,
      "thickness": 0.24,
      "bounds": {
        "minX": -18.38,
        "maxX": 18.38,
        "minZ": -13.5,
        "maxZ": 13.5
      }
    },
    "spawnEntries": [
      {
        "id": "north-culvert",
        "doorId": "north",
        "x": -4.2,
        "z": -18.4,
        "kind": "culvert"
      },
      {
        "id": "north-woods",
        "doorId": "north",
        "x": 4.2,
        "z": -18.4,
        "kind": "woods"
      },
      {
        "id": "south-woods",
        "doorId": "south",
        "x": -4.2,
        "z": 18.4,
        "kind": "woods"
      },
      {
        "id": "south-culvert",
        "doorId": "south",
        "x": 4.2,
        "z": 18.4,
        "kind": "culvert"
      },
      {
        "id": "west-woods",
        "doorId": "west",
        "x": -23.4,
        "z": -3.6,
        "kind": "woods"
      },
      {
        "id": "west-culvert",
        "doorId": "west",
        "x": -23.4,
        "z": 3.6,
        "kind": "culvert"
      },
      {
        "id": "east-culvert",
        "doorId": "east",
        "x": 23.4,
        "z": -3.6,
        "kind": "culvert"
      },
      {
        "id": "east-woods",
        "doorId": "east",
        "x": 23.4,
        "z": 3.6,
        "kind": "woods"
      }
    ],
    "raidEntries": [
      {
        "id": "raid-north-a",
        "doorId": "north",
        "x": -5,
        "z": -35
      },
      {
        "id": "raid-north-b",
        "doorId": "north",
        "x": 5,
        "z": -35
      },
      {
        "id": "raid-south-a",
        "doorId": "south",
        "x": -5,
        "z": 35
      },
      {
        "id": "raid-south-b",
        "doorId": "south",
        "x": 5,
        "z": 35
      },
      {
        "id": "raid-west-a",
        "doorId": "west",
        "x": -40,
        "z": -5
      },
      {
        "id": "raid-west-b",
        "doorId": "west",
        "x": -40,
        "z": 5
      },
      {
        "id": "raid-east-a",
        "doorId": "east",
        "x": 40,
        "z": -5
      },
      {
        "id": "raid-east-b",
        "doorId": "east",
        "x": 40,
        "z": 5
      }
    ],
    "supplyCaches": [
      {
        "x": -24,
        "y": 0,
        "z": 5
      },
      {
        "x": 23,
        "y": 0,
        "z": -8
      },
      {
        "x": -7,
        "y": 0,
        "z": -19
      }
    ],
    "interiorWalls": [],
    "loftRailHeight": 0,
    "loftRailTopBarY": 0,
    "spaceId": "funfair-depth",
    "minY": -3.4
  }
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS));
export const LEVEL = LEVELS[LEVEL_ID] ?? LEVELS.cabin;
export const IS_SUPERMARKET = LEVEL.id === 'supermarket';
export const IS_HOSPITAL = LEVEL.id === 'hospital';
export const IS_FUNFAIR = LEVEL.id === 'funfair';
export const HAS_SPACE = IS_SUPERMARKET || IS_HOSPITAL || IS_FUNFAIR;
export const IS_MULTI_FLOOR = HAS_SPACE;

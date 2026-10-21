// Camera/identity study data authored after inspecting current Tesla original pixels.
// No photograph supplies OEM CAD, EXIF calibration or material measurements.
export const VEHICLE_DISPLAY_CONFIGURATIONS=Object.freeze({
  experimental:{id:'experimental',name:'实验改装 · 单座',seatCount:1,scope:'Single seat, four-point harness, tanks, plumbing, inferred underfloor seal and actual model force nozzles. Engineering reconstruction; no OEM hidden-layout claim.'},
  'official-study':{id:'official-study',name:'原车外观 · 双座展示',seatCount:2,scope:'Visible exterior and two-front-seat public cabin study. Public trim photographs are not one measured factory configuration. Visible rear outlets follow the official photo; hidden force nozzles, tanks, piping and seal are not shown. Inspection only: mass, inertia, collision and driving records are unchanged.'}
});
export const VEHICLE_LAMP_MODES=Object.freeze([
  {id:'off',name:'熄灯'},{id:'drl',name:'日行灯'},{id:'low-beam',name:'近灯'}
]);
export const VEHICLE_REFERENCE_LIMITS='Camera intrinsics and original metric dimensions are unknown. Manually marked landmarks carry 10–12 px reading tolerance. The assumed lens, pose and image shift minimize 2D landmark mismatch; normalized error includes projection, annotation and geometry, and is not CAD accuracy. No geometry improvement is inferred from another light preset.';
export const VEHICLE_PHOTO_MATCHES=Object.freeze([
  {
    "id": "photo-side",
    "name": "官方侧面匹配（估计）",
    "file": "Roadster-02-Pilot-Desktop.jpg",
    "sourceURL": "https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-02-Pilot-Desktop.jpg",
    "sha256": "133de595f3cb7742f5bb2c24d8e9c41aef06dcd1a63507e2daaddc1c4a71c16a",
    "sourceResolution": [
      3440,
      1024
    ],
    "position": [
      11.347263899246867,
      1.9275125353353346,
      2.2105572617964984
    ],
    "target": [
      0,
      0,
      0
    ],
    "focalLengthMm": 50,
    "filmGaugeMm": 36,
    "frameShiftUV": [
      0.14657377499083707,
      0.017426543753121273
    ],
    "landmarks": [
      {
        "id": "front-axle",
        "pointM": [
          0.89,
          -0.227,
          1.42
        ],
        "photoUV": [
          0.495,
          0.686
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.486668797351853,
          0.6984016987214607
        ],
        "errorImageDiagonalFraction": 0.008733746418821735
      },
      {
        "id": "rear-axle",
        "pointM": [
          0.89,
          -0.227,
          -1.42
        ],
        "photoUV": [
          0.865,
          0.674
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.841151315966681,
          0.6523910197724077
        ],
        "errorImageDiagonalFraction": 0.023674300818657658
      },
      {
        "id": "front-tyre-top",
        "pointM": [
          0.89,
          0.145,
          1.42
        ],
        "photoUV": [
          0.495,
          0.535
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.4857429814484279,
          0.5374286302186009
        ],
        "errorImageDiagonalFraction": 0.008899289523845874
      },
      {
        "id": "rear-tyre-top",
        "pointM": [
          0.89,
          0.145,
          -1.42
        ],
        "photoUV": [
          0.865,
          0.52
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.8422235257980207,
          0.4989308206759444
        ],
        "errorImageDiagonalFraction": 0.022642318175275636
      },
      {
        "id": "nose",
        "pointM": [
          0.8664885673915688,
          -0.006748432915607131,
          2.3
        ],
        "photoUV": [
          0.389,
          0.618
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.36850817924329515,
          0.6151584692241915
        ],
        "errorImageDiagonalFraction": 0.01965685546362331
      },
      {
        "id": "windshield-base",
        "pointM": [
          0.885,
          0.28,
          0.8
        ],
        "photoUV": [
          0.505,
          0.48
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.5663616099449571,
          0.4701110867857326
        ],
        "errorImageDiagonalFraction": 0.058878906588283667
      },
      {
        "id": "roof-vertex",
        "pointM": [
          0.65,
          0.634,
          -0.22
        ],
        "photoUV": [
          0.686,
          0.322
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.6894228101874076,
          0.2943097819411632
        ],
        "errorImageDiagonalFraction": 0.00855414152970059
      },
      {
        "id": "rear-window-corner",
        "pointM": [
          0.7605984151695713,
          0.477201958809474,
          -1.48
        ],
        "photoUV": [
          0.811,
          0.367
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.8450303631818021,
          0.35286768635724375
        ],
        "errorImageDiagonalFraction": 0.03286425011535225
      },
      {
        "id": "rear-shoulder",
        "pointM": [
          1.0034885673915686,
          0.3893600244652815,
          -1.42
        ],
        "photoUV": [
          0.856,
          0.417
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.8476561414333897,
          0.4038002502800389
        ],
        "errorImageDiagonalFraction": 0.008839413945617639
      },
      {
        "id": "tail",
        "pointM": [
          0.9064885673915686,
          0.2547031006475261,
          -2.3
        ],
        "photoUV": [
          0.955,
          0.436
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.9471000539240438,
          0.44381960861899056
        ],
        "errorImageDiagonalFraction": 0.007893437382401709
      }
    ],
    "rmsImageDiagonalFraction": 0.02524958266082094,
    "cameraFit": "Original assumed 50 mm camera, pose and framing retained unchanged from 3.14. 3.18 updates the model points from the actual loft and top skin without refitting the camera. Residuals combine annotation, view fit and geometry; they do not isolate CAD accuracy or form improvement.",
    "geometryLandmarksRevision": "3.18 actual loft and top-skin samples; photo point associations remain authored hypotheses"
  },
  {
    "id": "photo-front",
    "name": "官方正前匹配（估计）",
    "file": "Roadster-03-Carousel-Slide-1-Desktop.jpg",
    "sourceURL": "https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-1-Desktop.jpg",
    "sha256": "ba430d2177eba7f84f8d70d16af95ae758e2323d8c4d22df08ce58c0844aa647",
    "sourceResolution": [
      2200,
      1040
    ],
    "position": [
      -0.09965207772056428,
      0.7855889381523343,
      9.08589023108209
    ],
    "target": [
      0,
      0,
      0
    ],
    "focalLengthMm": 50,
    "filmGaugeMm": 36,
    "frameShiftUV": [
      0.0001613479391508805,
      -0.012725110359387356
    ],
    "landmarks": [
      {
        "id": "roof-left",
        "pointM": [
          -0.6515856166743224,
          0.598,
          0.04
        ],
        "photoUV": [
          0.408,
          0.28
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.39992517237486175,
          0.29457795840058876
        ],
        "errorImageDiagonalFraction": 0.009597408000299089
      },
      {
        "id": "roof-right",
        "pointM": [
          0.6515856166743224,
          0.598,
          0.04
        ],
        "photoUV": [
          0.59,
          0.28
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.6003744288130962,
          0.2944813351462773
        ],
        "errorImageDiagonalFraction": 0.01123717400458705
      },
      {
        "id": "windshield-left",
        "pointM": [
          -0.885,
          0.28,
          0.8
        ],
        "photoUV": [
          0.343,
          0.424
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.35336151044101005,
          0.41312244748625343
        ],
        "errorImageDiagonalFraction": 0.010457668232838812
      },
      {
        "id": "windshield-right",
        "pointM": [
          0.885,
          0.28,
          0.8
        ],
        "photoUV": [
          0.66,
          0.424
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.6495526609135449,
          0.41270380362403813
        ],
        "errorImageDiagonalFraction": 0.010607457546075958
      },
      {
        "id": "nose-left",
        "pointM": [
          -0.62,
          -0.01,
          2.3
        ],
        "photoUV": [
          0.372,
          0.584
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.3790983892388353,
          0.5771194540298329
        ],
        "errorImageDiagonalFraction": 0.007059101270736582
      },
      {
        "id": "nose-right",
        "pointM": [
          0.62,
          -0.01,
          2.3
        ],
        "photoUV": [
          0.636,
          0.584
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.631233220421981,
          0.5764380037126109
        ],
        "errorImageDiagonalFraction": 0.005386716424436379
      },
      {
        "id": "shoulder-left",
        "pointM": [
          -0.9904885673915687,
          0.24933438869964186,
          1.42
        ],
        "photoUV": [
          0.335,
          0.421
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.3237119570144208,
          0.43935050647242824
        ],
        "errorImageDiagonalFraction": 0.012870630336082087
      },
      {
        "id": "shoulder-right",
        "pointM": [
          0.9904885673915687,
          0.24933438869964186,
          1.42
        ],
        "photoUV": [
          0.675,
          0.421
        ],
        "manualTolerancePixels": 10,
        "projectedUV": [
          0.6817361152662501,
          0.4387708090151222
        ],
        "errorImageDiagonalFraction": 0.009734964509322543
      }
    ],
    "rmsImageDiagonalFraction": 0.009871268815526928,
    "cameraFit": "Original assumed 50 mm camera, pose and framing retained unchanged from 3.14. 3.18 updates the model points from the actual loft and top skin without refitting the camera. Residuals combine annotation, view fit and geometry; they do not isolate CAD accuracy or form improvement.",
    "geometryLandmarksRevision": "3.18 actual loft and top-skin samples; photo point associations remain authored hypotheses"
  },
  {
    "id": "photo-front-quarter",
    "name": "官方前侧匹配（估计）",
    "file": "Roadster-08-End-Desktop.jpg",
    "sourceURL": "https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-08-End-Desktop.jpg",
    "sha256": "342e862f7239479b0d1994d1f842e50d05e926b8fd4c9158c02cc9f011bcc71b",
    "sourceResolution": [
      2800,
      2074
    ],
    "position": [
      4.082873826433696,
      0.6462860891735023,
      7.237209544300948
    ],
    "target": [
      0,
      0,
      0
    ],
    "focalLengthMm": 50,
    "filmGaugeMm": 36,
    "frameShiftUV": [
      0.02168974284764888,
      0.03837375531990916
    ],
    "landmarks": [
      {
        "id": "front-axle",
        "pointM": [
          0.89,
          -0.227,
          1.42
        ],
        "photoUV": [
          0.55,
          0.622
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.5377821263777502,
          0.638291856785875
        ],
        "errorImageDiagonalFraction": 0.013799469122061264
      },
      {
        "id": "rear-axle",
        "pointM": [
          0.89,
          -0.227,
          -1.42
        ],
        "photoUV": [
          0.789,
          0.574
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.7452786274424693,
          0.5720508206615817
        ],
        "errorImageDiagonalFraction": 0.03515221869389782
      },
      {
        "id": "front-tyre-top",
        "pointM": [
          0.89,
          0.145,
          1.42
        ],
        "photoUV": [
          0.55,
          0.535
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.5378518861115499,
          0.5342171232214843
        ],
        "errorImageDiagonalFraction": 0.009772943204903524
      },
      {
        "id": "nose-near",
        "pointM": [
          0.62,
          -0.01,
          2.3
        ],
        "photoUV": [
          0.4,
          0.596
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.38586823499487666,
          0.5970788195313537
        ],
        "errorImageDiagonalFraction": 0.011373965568222615
      },
      {
        "id": "nose-far",
        "pointM": [
          -0.62,
          -0.01,
          2.3
        ],
        "photoUV": [
          0.19,
          0.587
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.1724518363848324,
          0.5783720598071109
        ],
        "errorImageDiagonalFraction": 0.015007163457966105
      },
      {
        "id": "windshield-near",
        "pointM": [
          0.885,
          0.28,
          0.8
        ],
        "photoUV": [
          0.538,
          0.49
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.5947078813307514,
          0.4884194965270062
        ],
        "errorImageDiagonalFraction": 0.04557831201209519
      },
      {
        "id": "windshield-far",
        "pointM": [
          -0.885,
          0.28,
          0.8
        ],
        "photoUV": [
          0.294,
          0.502
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.3209244410880102,
          0.47809398837122774
        ],
        "errorImageDiagonalFraction": 0.025895348717769738
      },
      {
        "id": "roof-vertex",
        "pointM": [
          0.6515856166743224,
          0.598,
          0.04
        ],
        "photoUV": [
          0.593,
          0.404
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.6175909786869779,
          0.40398202982448006
        ],
        "errorImageDiagonalFraction": 0.01976051074531136
      },
      {
        "id": "rear-window-corner",
        "pointM": [
          0.7605984151695713,
          0.477201958809474,
          -1.48
        ],
        "photoUV": [
          0.706,
          0.443
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.7312505368141928,
          0.4270638430488135
        ],
        "errorImageDiagonalFraction": 0.022398167197368903
      },
      {
        "id": "rear-shoulder",
        "pointM": [
          1.0034885673915686,
          0.3893600244652815,
          -1.42
        ],
        "photoUV": [
          0.791,
          0.458
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.7630105983514233,
          0.4459542228805987
        ],
        "errorImageDiagonalFraction": 0.02360652297119561
      },
      {
        "id": "tail",
        "pointM": [
          0.9064885673915686,
          0.2547031006475261,
          -2.3
        ],
        "photoUV": [
          0.809,
          0.459
        ],
        "manualTolerancePixels": 12,
        "projectedUV": [
          0.7918733629033303,
          0.46716829029124657
        ],
        "errorImageDiagonalFraction": 0.014595948242289793
      }
    ],
    "rmsImageDiagonalFraction": 0.023906281440671775,
    "cameraFit": "Original assumed 50 mm camera, pose and framing retained unchanged from 3.14. 3.18 updates the model points from the actual loft and top skin without refitting the camera. Residuals combine annotation, view fit and geometry; they do not isolate CAD accuracy or form improvement.",
    "geometryLandmarksRevision": "3.18 actual loft and top-skin samples; photo point associations remain authored hypotheses"
  }
]);
export const VEHICLE_CABIN_REFERENCE=Object.freeze({id:'photo-cabin',name:'官方座舱匹配（估计）',file:'Roadster-03-Carousel-Slide-4-Desktop.jpg',sourceURL:'https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Desktop.jpg',sha256:'ff5202948ce91631a5a9cf290c844baaa9cb739db74a9080488da1705552bfd2',sourceResolution:[2200,1040],position:[0,.49,-.70],target:[0,.23,.55],focalLengthMm:18,filmGaugeMm:36,frameShiftUV:[0,0],landmarks:[],rmsImageDiagonalFraction:null,cameraFit:'Visual framing estimate only; cabin depth and unexposed interior surfaces are not calibrated. 18 mm is an authored comparison lens, not recovered Tesla camera metadata.'});
export const VEHICLE_EXTRA_TECHNICAL_VIEWS=Object.freeze([
  {id:'cabin',name:'座舱内部 · 18 mm',position:[0,.49,-.70],target:[0,.23,.55],focalLengthMm:18},
  {id:'tail-installation',name:'尾部安装关系',position:[1.75,.18,-4.10],target:[0,-.07,-2.27],focalLengthMm:50}
]);
export const VEHICLE_STUDY_VIEWS=Object.freeze(['front','side','front-quarter','rear-quarter','rear-wheel','cabin']);
export function normalizedLandmarkReport(THREE,camera,transform,preset){
  if(!preset?.landmarks?.length)return {status:'unavailable',reason:'This view has no measured/annotated exterior landmarks; no numerical fit claim.'};
  camera.updateMatrixWorld(true);
  const [width,height]=preset.sourceResolution,diagonal=Math.hypot(width,height);
  const points=preset.landmarks.map(mark=>{
    const p=new THREE.Vector3(...mark.pointM).applyMatrix4(transform).project(camera),projectedUV=[(p.x+1)/2,(1-p.y)/2],deltaPixels=projectedUV.map((value,i)=>(value-mark.photoUV[i])*[width,height][i]);
    return{id:mark.id,pointM:[...mark.pointM],photoUV:[...mark.photoUV],projectedUV,errorPixels:Math.hypot(...deltaPixels),errorImageDiagonalFraction:Math.hypot(...deltaPixels)/diagonal,manualTolerancePixels:mark.manualTolerancePixels,visibleInClip:p.z>=-1&&p.z<=1};
  });
  return{status:'design-comparison-only',normalization:'original photograph image diagonal',rmsImageDiagonalFraction:Math.sqrt(points.reduce((sum,p)=>sum+p.errorImageDiagonalFraction**2,0)/points.length),points,limits:VEHICLE_REFERENCE_LIMITS};
}
export function letterboxViewport(width,height,aspect){
  if(![width,height,aspect].every(Number.isFinite)||width<=0||height<=0||aspect<=0)throw new RangeError('Invalid inspection viewport.');
  const w=Math.min(width,height*aspect),h=w/aspect;return{x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}

export const viewports = {
  DESKTOP: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  // IPHONE: {
  //   width: 375,
  //   height: 812,
  //   deviceScaleFactor: 3,
  //   isMobile: true,
  //   hasTouch: true,
  //   isLandscape: false,
  // },
} as const;

export const axeConfig = {
  tags: ["EN-301-549"],
  // You can add more axe-core config options here if needed
};

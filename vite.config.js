export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three/examples/jsm/controls/OrbitControls.js'],
        },
      },
    },
  },
};

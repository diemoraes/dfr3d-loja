// Visualizador de modelos 3D (STL, OBJ, 3MF) em tela cheia, usando Three.js via CDN.
// Compartilhado entre o painel admin (arquivos de encomenda já enviados) e a página
// pública de "Sob encomenda" (preview do arquivo antes de enviar).
(() => {
  const VISOR3D_EXTENSOES = ['stl', 'obj', '3mf'];
  const CDN_THREE = 'https://esm.sh/three@0.160.0';
  let estado = null;

  const extensao = (nome) => String(nome ?? '').split('.').pop().toLowerCase();

  function fechar() {
    const overlay = document.getElementById('visor3d');
    if (estado) {
      cancelAnimationFrame(estado.raf);
      window.removeEventListener('resize', estado.onResize);
      try { estado.renderer.dispose(); } catch { /* ignora */ }
      estado = null;
    }
    overlay?.remove();
  }

  /**
   * @param {string|ArrayBuffer} fonte URL (será baixada) ou ArrayBuffer já em mãos.
   * @param {string} nomeArquivo nome do arquivo, usado para detectar a extensão e no título.
   */
  async function abrir(fonte, nomeArquivo) {
    fechar();
    const ext = extensao(nomeArquivo);
    const overlay = document.createElement('div');
    overlay.id = 'visor3d';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,12,.94);display:flex;flex-direction:column';
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.2rem;color:#fff;flex:none">
        <strong style="font-size:.95rem">${String(nomeArquivo ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</strong>
        <button type="button" id="visor3d-fechar" style="background:none;border:none;color:#fff;font-size:1.7rem;line-height:1;cursor:pointer">×</button>
      </div>
      <div id="visor3d-area" style="flex:1;position:relative;min-height:0">
        <p id="visor3d-msg" style="color:#ddd;text-align:center;margin-top:3rem">Carregando modelo…</p>
      </div>`;
    document.body.append(overlay);
    document.getElementById('visor3d-fechar').onclick = fechar;
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) fechar(); });

    const msg = () => document.getElementById('visor3d-msg');
    try {
      if (!VISOR3D_EXTENSOES.includes(ext)) {
        throw new Error(`Pré-visualização não disponível para .${ext}. Baixe o arquivo para abrir num programa de CAD.`);
      }

      const [THREE, { OrbitControls }] = await Promise.all([
        import(/* webpackIgnore: true */ CDN_THREE),
        import(/* webpackIgnore: true */ `${CDN_THREE}/examples/jsm/controls/OrbitControls.js`),
      ]);

      let buffer;
      if (typeof fonte === 'string') {
        const resp = await fetch(fonte);
        if (!resp.ok) throw new Error('Não foi possível baixar o arquivo.');
        buffer = await resp.arrayBuffer();
      } else {
        buffer = fonte;
      }

      let objeto;
      if (ext === 'stl') {
        const { STLLoader } = await import(/* webpackIgnore: true */ `${CDN_THREE}/examples/jsm/loaders/STLLoader.js`);
        const geometria = new STLLoader().parse(buffer);
        geometria.computeVertexNormals();
        objeto = new THREE.Mesh(geometria, new THREE.MeshStandardMaterial({ color: 0xcbd0d6, metalness: 0.1, roughness: 0.7 }));
      } else if (ext === 'obj') {
        const { OBJLoader } = await import(/* webpackIgnore: true */ `${CDN_THREE}/examples/jsm/loaders/OBJLoader.js`);
        objeto = new OBJLoader().parse(new TextDecoder().decode(buffer));
        objeto.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xcbd0d6, metalness: 0.1, roughness: 0.7 }); });
      } else {
        const { ThreeMFLoader } = await import(/* webpackIgnore: true */ `${CDN_THREE}/examples/jsm/loaders/3MFLoader.js`);
        objeto = new ThreeMFLoader().parse(buffer);
      }

      if (!document.getElementById('visor3d')) return; // fechado enquanto carregava
      const area = document.getElementById('visor3d-area');
      msg()?.remove();

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x15151a);
      const camera = new THREE.PerspectiveCamera(50, area.clientWidth / area.clientHeight, 0.1, 100000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(area.clientWidth, area.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      area.append(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const luz1 = new THREE.DirectionalLight(0xffffff, 0.9); luz1.position.set(1, 2, 3); scene.add(luz1);
      const luz2 = new THREE.DirectionalLight(0xffffff, 0.4); luz2.position.set(-2, -1, -2); scene.add(luz2);

      scene.add(objeto);
      const caixa = new THREE.Box3().setFromObject(objeto);
      const centro = caixa.getCenter(new THREE.Vector3());
      const tamanho = caixa.getSize(new THREE.Vector3());
      const raio = Math.max(tamanho.x, tamanho.y, tamanho.z, 1);
      objeto.position.sub(centro);
      camera.position.set(raio * 1.3, raio * 1.1, raio * 1.3);
      camera.lookAt(0, 0, 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;

      const onResize = () => {
        if (!area.isConnected) return;
        camera.aspect = area.clientWidth / area.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(area.clientWidth, area.clientHeight);
      };
      window.addEventListener('resize', onResize);

      estado = { raf: 0, renderer, onResize };
      const animar = () => {
        controls.update();
        renderer.render(scene, camera);
        estado.raf = requestAnimationFrame(animar);
      };
      animar();
    } catch (err) {
      const m = msg();
      if (m) m.textContent = err.message || 'Não foi possível carregar a pré-visualização.';
    }
  }

  window.Visor3D = { abrir, fechar, extensoes: VISOR3D_EXTENSOES, extensao };
})();

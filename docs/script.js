'use strict';

var canvas = document.getElementsByTagName('canvas')[0];
resizeCanvas();

var config = {
    SIM_RESOLUTION: 512,
    DYE_RESOLUTION: 1024,
    CAPTURE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 0.15,
    VELOCITY_DISSIPATION: 0.003,
    PRESSURE: 0.0,
    PRESSURE_ITERATIONS: 10,
    CURL: 0,
    RADIUS_MIN: 0.005,
    RADIUS_RANGE: 0.01,
    SPLAT_FORCE: 1800,
    SPLAT_BIAS: 5,
    SPLAT_BROWN: 1.1,
    BROWN_BIAS: 0.8,
    FREQUENCY: 0.07,
    COLORFUL: false,
    REVERSE: false,
    PAUSED: false,
    BACKGROUND: 0.02,
}

var sim_resolutions = [512,256,256,256,512];
var density_diffusions = [0.15,0.9,0.013,0.013,0.05];
var velocity_diffusions = [0.003,0.2,0.01,0.075,0.75];
var curls = [0,3,10,15,50];
var radius_mins = [0.01,0.035,0.01,0.01,0.01];
var radius_ranges = [0.01,0.065,0.09,0.09,0.14];
var splat_forces = [1800,1600,800,800,800];
var splat_biass = [10,15,1,2,1.5];
var splat_browns = [1.1,1.5,1.5,0.85,1.5];
var brown_biass = [0.8,5.5,0.3,0.3,0.3];
var colorfuls = [false,false,false,true,true];
var frequencys = [0.07,0.4,0.1,0.2,0.2];

var pointers = [];

var ref = getWebGLContext(canvas);
var gl = ref.gl;
var ext = ref.ext;

if (isMobile()) {
    config.DYE_RESOLUTION = 512;
}
if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 512;
}

startGUI();

function getWebGLContext (canvas) {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    var gl = canvas.getContext('webgl2', params);
    var isWebGL2 = !!gl;
    if (!isWebGL2)
        { gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params); }

    var halfFloat;
    var supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    var formatRGBA;
    var formatRG;
    var formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    ga('send', 'event', isWebGL2 ? 'webgl2' : 'webgl', formatRGBA == null ? 'not supported' : 'supported');

    return {
        gl: gl,
        ext: {
            formatRGBA: formatRGBA,
            formatRG: formatRG,
            formatR: formatR,
            halfFloatTexType: halfFloatTexType,
            supportLinearFiltering: supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat: internalFormat,
        format: format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status == gl.FRAMEBUFFER_COMPLETE;
}

function startGUI () {
    var gui = new dat.GUI({ width: 300 });
    gui.add(config, 'DYE_RESOLUTION', { 'high': 1024, 'medium': 512, 'low': 256, 'very low': 128 }).name('quality').onFinishChange(initFramebuffers);
    gui.add(config, 'SIM_RESOLUTION', { '32': 32, '64': 64, '128': 128, '256': 256 , '512': 512}).name('sim resolution').listen().onFinishChange(initFramebuffers);
    gui.add(config, 'DENSITY_DISSIPATION', 0, 2.0).name('density diffusion').listen();
    gui.add(config, 'VELOCITY_DISSIPATION', 0, 1.5).name('velocity diffusion').listen();
    gui.add(config, 'PRESSURE', 0.0, 1.0).name('pressure');
    gui.add(config, 'CURL', 0, 50).name('curl').step(1).listen();
    gui.add(config, 'RADIUS_MIN', 0.001, 0.05).name('radius minimum').listen();
    gui.add(config, 'RADIUS_RANGE',0.0, 0.15).name('radius range').listen();
    gui.add(config, 'SPLAT_FORCE', 100,2000).name('splat force').listen();
    gui.add(config, 'SPLAT_BIAS', 1,15).name('splat volume').listen();
    gui.add(config, 'SPLAT_BROWN', 0.0,1.5).name('splat brown').listen();
    gui.add(config, 'BROWN_BIAS', 0,20).name('brown activity').listen();
    gui.add(config, 'FREQUENCY', 0,1).name('frequency').listen();
    gui.add(config, 'COLORFUL').name('colorful').listen();
    gui.add(config, 'REVERSE').name('reverse').listen().onFinishChange(updateKeywords);
    gui.add(config, 'PAUSED').name('paused').listen();
    gui.add(config, 'BACKGROUND',0.0,1.0).name('background').listen();

    gui.close();
}

function isMobile () {
    return /Mobi|Android/i.test(navigator.userAgent);
}

var Material = function Material (vertexShader, fragmentShaderSource) {
    this.vertexShader = vertexShader;
    this.fragmentShaderSource = fragmentShaderSource;
    this.programs = [];
    this.activeProgram = null;
    this.uniforms = [];
};

Material.prototype.setKeywords = function setKeywords (keywords) {
    var hash = 0;
    for (var i = 0; i < keywords.length; i++)
        { hash += hashCode(keywords[i]); }

    var program = this.programs[hash];
    if (program == null)
    {
        var fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
        program = createProgram(this.vertexShader, fragmentShader);
        this.programs[hash] = program;
    }

    if (program == this.activeProgram) { return; }

    this.uniforms = getUniforms(program);
    this.activeProgram = program;
};

Material.prototype.bind = function bind () {
    gl.useProgram(this.activeProgram);
};

var Program = function Program (vertexShader, fragmentShader) {
    this.uniforms = {};
    this.program = createProgram(vertexShader, fragmentShader);
    this.uniforms = getUniforms(this.program);
};

Program.prototype.bind = function bind () {
    gl.useProgram(this.program);
};

function createProgram (vertexShader, fragmentShader) {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        { throw gl.getProgramInfoLog(program); }

    return program;
}

function getUniforms (program) {
    var uniforms = [];
    var uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniformCount; i++) {
        var uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
    }
    return uniforms;
}

function compileShader (type, source, keywords) {
    source = addKeywords(source, keywords);

    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        { throw gl.getShaderInfoLog(shader); }

    return shader;
};

function addKeywords (source, keywords) {
    if (keywords == null) { return source; }
    var keywordsString = '';
    keywords.forEach(function (keyword) {
        keywordsString += '#define ' + keyword + '\n';
    });
    return keywordsString + source;
}

var baseVertexShader = compileShader(gl.VERTEX_SHADER,baseVertexShaderSource);
var copyShader = compileShader(gl.FRAGMENT_SHADER,copyShaderSource);
var clearShader = compileShader(gl.FRAGMENT_SHADER,clearShaderSource);
var splatShader = compileShader(gl.FRAGMENT_SHADER,splatShaderSource);
var splatColorShader = compileShader(gl.FRAGMENT_SHADER,splatColorShaderSource);
var brownShader = compileShader(gl.FRAGMENT_SHADER,brownShaderSource);
var advectionShader = compileShader(gl.FRAGMENT_SHADER,advectionShaderSource,ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);
var divergenceShader = compileShader(gl.FRAGMENT_SHADER,divergenceShaderSource);
var curlShader = compileShader(gl.FRAGMENT_SHADER,curlShaderSource);
var vorticityShader = compileShader(gl.FRAGMENT_SHADER,vorticityShaderSource);
var pressureShader = compileShader(gl.FRAGMENT_SHADER,pressureShaderSource);
var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER,gradientSubtractShaderSource);
var blit = (function () {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return function (destination) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

var dye;
var velocity;
var divergence;
var curl;
var pressure;

var copyProgram            = new Program(baseVertexShader, copyShader);
var clearProgram           = new Program(baseVertexShader, clearShader);
var splatProgram           = new Program(baseVertexShader, splatShader);
var splatColorProgram      = new Program(baseVertexShader, splatColorShader);
var brownProgram           = new Program(baseVertexShader, brownShader);
var advectionProgram       = new Program(baseVertexShader, advectionShader);
var divergenceProgram      = new Program(baseVertexShader, divergenceShader);
var curlProgram            = new Program(baseVertexShader, curlShader);
var vorticityProgram       = new Program(baseVertexShader, vorticityShader);
var pressureProgram        = new Program(baseVertexShader, pressureShader);
var gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

var displayMaterial = new Material(baseVertexShader, displayShaderSource);

function initFramebuffers () {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);

    var texType = ext.halfFloatTexType;
    var rgba    = ext.formatRGBA;
    var rg      = ext.formatRG;
    var r       = ext.formatR;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    if (dye == null)
        { dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering); }
    else
        { dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering); }

    if (velocity == null)
        { velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering); }
    else
        { velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering); }

    divergence = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
}

function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    var texelSizeX = 1.0 / w;
    var texelSizeY = 1.0 / h;

    return {
        texture: texture,
        fbo: fbo,
        width: w,
        height: h,
        texelSizeX: texelSizeX,
        texelSizeY: texelSizeY,
        attach: function attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, param);
    var fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap: function swap () {
            var temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function resizeFBO (target, w, h, internalFormat, format, type, param) {
    var newFBO = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(newFBO.fbo);
    return newFBO;
}

function resizeDoubleFBO (target, w, h, internalFormat, format, type, param) {
    if (target.width == w && target.height == h)
        { return target; }
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
}

function createTextureAsync (url) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    var obj = {
        texture: texture,
        width: 1,
        height: 1,
        attach: function attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };

    var image = new Image();
    image.onload = function () {
        obj.width = image.width;
        obj.height = image.height;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    };
    image.src = url;

    return obj;
}

function updateKeywords () {
    var displayKeywords = [];
    if (config.REVERSE) { displayKeywords.push("REVERSE"); }
    displayMaterial.setKeywords(displayKeywords);
}



updateKeywords();
initFramebuffers();

var lastUpdateTime = Date.now();

update();

function update () {
    var dt = calcDeltaTime();
    if (resizeCanvas())
        { initFramebuffers(); }
    if (!config.PAUSED) {
        if (Math.random()<(Math.pow(config.FREQUENCY,2.0))) {
            splat(Math.random(),Math.random(),(Math.random()*0.7+0.3)*config.SPLAT_BIAS,
            config.RADIUS_MIN/100+Math.random()*config.RADIUS_RANGE/100);
            // config.BACKGROUND += 0.001;
        }
        step(dt); }
    applyBrown();
    drawDisplay();
    requestAnimationFrame(update);
}

function calcDeltaTime () {
    var now = Date.now();
    var dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas () {
    var width = scaleByPixelRatio(canvas.clientWidth);
    var height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }
    return false;
}

function step (dt) {
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, velocity.width, velocity.height);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl.fbo);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write.fbo);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence.fbo);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write.fbo);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write.fbo);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write.fbo);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
        { gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY); }
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dye.width, dye.height);

    if (!ext.supportLinearFiltering)
        { gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY); }
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write.fbo);
    dye.swap();
}

function drawDisplay () {
    displayMaterial.bind();
    gl.viewport(0, 0,gl.drawingBufferWidth,gl.drawingBufferHeight);
    gl.uniform1f(displayMaterial.uniforms.background,config.BACKGROUND);
    gl.uniform1f(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    blit(null);
}

function splat(x,y,volume,radius) {
    gl.viewport(0, 0, velocity.width, velocity.height);
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point,x,y);
    gl.uniform1f(splatProgram.uniforms.bias,(Math.random()*0.7+0.3)*config.SPLAT_FORCE);
    gl.uniform1f(splatProgram.uniforms.radius,radius);
    gl.uniform1f(splatProgram.uniforms.a1,Math.random());
    gl.uniform1f(splatProgram.uniforms.a2,Math.random());
    gl.uniform1f(splatProgram.uniforms.b1,Math.random());
    gl.uniform1f(splatProgram.uniforms.b2,Math.random());
    gl.uniform1f(splatProgram.uniforms.brown_bias,config.SPLAT_BROWN);
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dye.width, dye.height);
    splatColorProgram.bind();
    gl.uniform1f(splatColorProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform1i(splatColorProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform2f(splatColorProgram.uniforms.point, x, y);
    gl.uniform1f(splatColorProgram.uniforms.radius,radius);
    if (config.COLORFUL) {
        var color = hsv2rgb(Math.random()*360,1.0,volume);
        gl.uniform3f(splatColorProgram.uniforms.color,color[0],color[1],color[2]);
    }
    else {
        gl.uniform3f(splatColorProgram.uniforms.color,volume,volume,volume);
    }
    blit(dye.write.fbo);
    dye.swap();
}

function applyBrown() {
    gl.viewport(0, 0, velocity.width, velocity.height);
    brownProgram.bind();
    gl.uniform1i(brownProgram.uniforms.uVelocity,velocity.read.attach(0));
    gl.uniform1f(brownProgram.uniforms.bias,config.BROWN_BIAS);
    gl.uniform1f(brownProgram.uniforms.a1,Math.random());
    gl.uniform1f(brownProgram.uniforms.a2,Math.random());
    gl.uniform1f(brownProgram.uniforms.b1,Math.random());
    gl.uniform1f(brownProgram.uniforms.b2,Math.random());
    blit(velocity.write.fbo);
    velocity.swap();
}

function hsv2rgb(H,S,V) {
    var C = V * S;
    var Hp = H / 60;
    var X = C * (1 - Math.abs(Hp % 2 - 1));
    var R, G, B;
    if (0 <= Hp && Hp < 1) {[R,G,B]=[C,X,0]};
    if (1 <= Hp && Hp < 2) {[R,G,B]=[X,C,0]};
    if (2 <= Hp && Hp < 3) {[R,G,B]=[0,C,X]};
    if (3 <= Hp && Hp < 4) {[R,G,B]=[0,X,C]};
    if (4 <= Hp && Hp < 5) {[R,G,B]=[X,0,C]};
    if (5 <= Hp && Hp < 6) {[R,G,B]=[C,0,X]};
    var m = V - C;
    [R, G, B] = [R+m, G+m, B+m];
    return [R ,G, B];
}

canvas.addEventListener('mousedown', function (e) {
    var posX = scaleByPixelRatio(e.offsetX);
    var posY = scaleByPixelRatio(e.offsetY);
    splat(posX/canvas.width,1.0-posY/canvas.height,(Math.random()*0.7+0.3)*config.SPLAT_BIAS,
    config.RADIUS_MIN/100+Math.random()*config.RADIUS_RANGE/100);
});

window.addEventListener('keydown', function (e) {
    if (e.key === '1')
        { changePreset(0); }
    if (e.key === '2')
        { changePreset(1); }
    if (e.key === '3')
        { changePreset(2); }
    if (e.key === '4')
        { changePreset(3); }
    if (e.key === '5')
        { changePreset(4); }
    if (e.key === 'r') {
        config.REVERSE = !config.REVERSE;
        updateKeywords();
    }
    if (e.key === 'c') {
        dye = null;
        velocity = null;
        initFramebuffers();
    }
    if (e.key === 'p') {
        config.PAUSED = !config.PAUSED;
    }
});

function changePreset(num) {
    config.SIM_RESOLUTION = sim_resolutions[num];
    config.DENSITY_DISSIPATION = density_diffusions[num];
    config.VELOCITY_DISSIPATION = velocity_diffusions[num];
    config.CURL = curls[num];
    config.RADIUS_MIN = radius_mins[num];
    config.RADIUS_RANGE = radius_ranges[num];
    config.SPLAT_FORCE = splat_forces[num];
    config.SPLAT_BIAS = splat_biass[num];
    config.SPLAT_BROWN = splat_browns[num];
    config.BROWN_BIAS = brown_biass[num];
    config.COLORFUL = colorfuls[num];
    config.FREQUENCY = frequencys[num];
    updateKeywords();
}

function getResolution (resolution) {
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        { aspectRatio = 1.0 / aspectRatio; }

    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        { return { width: max, height: min }; }
    else
        { return { width: min, height: max }; }
}

function scaleByPixelRatio (input) {
    var pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function hashCode (s) {
    if (s.length == 0) { return 0; }
    var hash = 0;
    for (var i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

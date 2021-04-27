import { Gemstone } from "./gemstone";
import { Shader } from "./gl-utils/shader";
import * as ShaderManager from "./gl-utils/shader-manager";
import { VBO } from "./gl-utils/vbo";
import { OrbitalCamera } from "./orbital-camera";
import { Parameters } from "./parameters";

import "./page-interface-generated";

declare const mat4: any;


const UNIT_CUBE = new Float32Array([
    -.5, -.5, -.5,
    +.5, -.5, -.5,
    -.5, -.5, +.5,
    +.5, -.5, -.5,
    +.5, -.5, +.5,
    -.5, -.5, +.5,

    +.5, -.5, -.5,
    +.5, +.5, -.5,
    +.5, -.5, +.5,
    +.5, +.5, -.5,
    +.5, +.5, +.5,
    +.5, -.5, +.5,

    -.5, -.5, +.5,
    +.5, -.5, +.5,
    -.5, +.5, +.5,
    +.5, -.5, +.5,
    +.5, +.5, +.5,
    -.5, +.5, +.5,

    -.5, +.5, -.5,
    -.5, +.5, +.5,
    +.5, +.5, -.5,
    +.5, +.5, -.5,
    -.5, +.5, +.5,
    +.5, +.5, +.5,

    -.5, -.5, -.5,
    -.5, -.5, +.5,
    -.5, +.5, -.5,
    -.5, +.5, -.5,
    -.5, -.5, +.5,
    -.5, +.5, +.5,

    -.5, -.5, -.5,
    -.5, +.5, -.5,
    +.5, -.5, -.5,
    +.5, -.5, -.5,
    -.5, +.5, -.5,
    +.5, +.5, -.5,
]);


class Drawer {
    private readonly gl: WebGLRenderingContext;
    private readonly VBO: VBO;
    private readonly pMatrix: number[];
    private readonly mvpMatrix: number[];

    private readonly camera: OrbitalCamera;

    private shader: Shader;

    public constructor(gl: WebGLRenderingContext, gemstone: Gemstone) {
        Page.Canvas.showLoader(true);

        this.gl = gl;
        this.VBO = new VBO(gl, UNIT_CUBE, 3, gl.FLOAT, true);

        this.pMatrix = mat4.create();
        this.mvpMatrix = mat4.create();
        this.camera = new OrbitalCamera([0, 0, 0], 1.8);
        this.camera.phi = 1.1;
        this.camera.theta = 2;

        const EPSILON = 0.2;
        const minPhi = EPSILON;
        const maxPhi = Math.PI - EPSILON;
        Page.Canvas.Observers.mouseDrag.push((dX: number, dY: number) => {
            this.camera.theta -= 0.5 * 2 * 3.14159 * dX;
            this.camera.phi -= 0.5 * 2 * 3 * dY;
            this.camera.phi = Math.min(maxPhi, Math.max(minPhi, this.camera.phi));
            this.updateMVPMatrix();
        });

        const minDist = 1.8;
        const maxDist = 8;
        Page.Canvas.Observers.mouseWheel.push((delta: number) => {
            let d = this.camera.distance + 0.2 * delta;
            d = Math.min(maxDist, Math.max(minDist, d));
            this.camera.distance = d;
            this.updateMVPMatrix();
        });
        this.updateMVPMatrix();

        Page.Canvas.Observers.canvasResize.push(() => {
            this.updateMVPMatrix();
        });

        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CCW);
        gl.cullFace(gl.FRONT);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        function updateBackgroundColor(): void {
            const backgroundColor = Parameters.backgroundColor;
            gl.clearColor(backgroundColor.r / 255, backgroundColor.g / 255, backgroundColor.b / 255, 1);
        }
        Parameters.addBackgroundColorObserver(updateBackgroundColor);
        updateBackgroundColor();

        const recomputeShader = () => {
            this.updateShader(gemstone);
        };
        Parameters.addRecomputeShaderObservers(recomputeShader);
        recomputeShader();
    }

    public draw(): void {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        if (this.shader) {
            Page.Canvas.showLoader(false);

            const gemColor = Parameters.gemColor;
            const gemAbsorption = Parameters.absorption;

            this.shader.a["aPosition"].VBO = this.VBO;
            this.shader.u["uMVPMatrix"].value = this.mvpMatrix;
            this.shader.u["uEyePosition"].value = this.camera.eyePos;
            this.shader.u["uAbsorption"].value = [
                gemAbsorption * (1 - gemColor.r / 255),
                gemAbsorption * (1 - gemColor.g / 255),
                gemAbsorption * (1 - gemColor.b / 255),
            ];
            this.shader.u["uDisplayNormals"].value = Parameters.displayNormals ? 1 : 0;
            this.shader.u["uRefractionIndex"].value = Parameters.refractionIndex;

            this.shader.use();
            this.shader.bindUniformsAndAttributes();
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 3 * 2 * 6);
        }
    }

    private updateMVPMatrix(): void {
        mat4.perspective(this.pMatrix, 45, Page.Canvas.getAspectRatio(), 0.1, 100.0);
        mat4.multiply(this.mvpMatrix, this.pMatrix, this.camera.viewMatrix);
    }

    private updateShader(gemstone: Gemstone): void {
        const facetsDefinitionInstructions: string[] = [];
        const computeEntryPointInstructions: string[] = [];
        const checkIfInsideInstructions: string[] = [];
        const computeInternalIntersectionInstructions: string[] = [];
        for (let i = 0; i < gemstone.facets.length; i++) {
            const facet = gemstone.facets[i];
            const facetPointName = `FACET_${i}_POINT`;
            const facetNormalName = `FACET_${i}_NORMAL`;

            facetsDefinitionInstructions.push(`const vec3 ${facetPointName} = vec3(${facet.point.x},${facet.point.y},${facet.point.z});`);
            facetsDefinitionInstructions.push(`const vec3 ${facetNormalName} = vec3(${facet.normal.x},${facet.normal.y},${facet.normal.z});`);

            computeEntryPointInstructions.push(`computeIntersectionWithPlane(${facetPointName}, ${facetNormalName}, eyePosition, fromEyeNormalized, theta, facetNormal);`);
            checkIfInsideInstructions.push(`isInside(${facetPointName}, ${facetNormalName}, entryPoint)`);
            computeInternalIntersectionInstructions.push(`checkNextInternalIntersection(${facetPointName}, ${facetNormalName}, position, direction, theta, facetNormal);`);
        }

        ShaderManager.buildShader({
            fragmentFilename: "shader.frag",
            vertexFilename: "shader.vert",
            injected: {
                FACETS_DEFINITION: facetsDefinitionInstructions.join("\n"),
                COMPUTE_ENTRY_POINT: computeEntryPointInstructions.join("\n\t"),
                CHECK_IF_INSIDE: checkIfInsideInstructions.join(" && "),
                COMPUTE_INTERNAL_INTERSECTION: computeInternalIntersectionInstructions.join("\n\t"),
                RAY_DEPTH: Parameters.rayDepth.toString(),
            },
        }, (builtShader: Shader | null) => {
            Page.Canvas.showLoader(false);
            if (this.shader) {
                this.shader.freeGLResources();
                this.shader = undefined;
            }

            if (builtShader !== null) {
                this.shader = builtShader;
            } else {
                Page.Demopage.setErrorMessage(`shader_load_fail`, `Failed to load/build the shader.`);
            }
        });
    }
}

export { Drawer };


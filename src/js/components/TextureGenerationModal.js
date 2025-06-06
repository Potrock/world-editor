import React, { useState, useCallback, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { FaUndo, FaRedo } from "react-icons/fa";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import EditorToolbar, { TOOLS } from "./EditorToolbar";
import ColorPalette from "./ColorPalette";
import PixelEditorCanvas from "./PixelEditorCanvas";
import BlockPreview3D from "./BlockPreview3D";
import FaceSelector from "./FaceSelector";
import "../../css/TextureGenerationModal.css"; // We'll create this CSS file next
import "../../css/BlockPreview3D.css"; // Import preview CSS
import "../../css/FaceSelector.css"; // Import face selector CSS
import "../../css/EditorToolbar.css"; // Ensure toolbar CSS is imported for button styles
import * as THREE from "three"; // Import THREE

const FACES = ["all", "top", "bottom", "left", "right", "front", "back"];
const GRID_SIZE = 24; // Ensure grid size is accessible here

// Helper to create an empty texture
const createTexture = (size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
};

const TextureGenerationModal = ({ isOpen, onClose, onTextureReady }) => {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    // State to hold the actual THREE.CanvasTexture objects
    const [textureObjects, setTextureObjects] = useState({});
    const [error, setError] = useState(null);
    const [hCaptchaToken, setHCaptchaToken] = useState(null);
    const [captchaError, setCaptchaError] = useState(null);
    const hCaptchaRef = useRef(null); // Ref for resetting captcha

    // Editor state
    const [selectedTool, setSelectedTool] = useState(TOOLS.PENCIL);
    const [selectedColor, setSelectedColor] = useState("#000000");
    const [selectedFace, setSelectedFace] = useState("all");

    // Ref for the canvas component
    const pixelCanvasRef = useRef(null);

    // State to track undo/redo availability for button disabling
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // Effect to dispose textures on unmount
    useEffect(() => {
        return () => {
            Object.values(textureObjects).forEach((texture) =>
                texture?.dispose()
            );
        };
    }, [textureObjects]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }

        setIsLoading(true);
        // Dispose existing textures before creating new ones
        Object.values(textureObjects).forEach((texture) => texture?.dispose());
        setTextureObjects({});
        setError(null);
        setSelectedFace("all");
        setCaptchaError(null); // Clear captcha error on new generation attempt

        if (!hCaptchaToken) {
            setCaptchaError("Please complete the CAPTCHA verification.");
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_texture`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        hCaptchaToken: hCaptchaToken,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const data = await response.json();

            console.log(data);

            if (data.base64_image) {
                const imageDataUrl = `data:image/png;base64,${data.base64_image}`;

                // Load the image
                const img = new Image();
                img.onload = () => {
                    const newTextureObjects = {};
                    FACES.forEach((face) => {
                        const texture = createTexture(GRID_SIZE);
                        const ctx = texture.image.getContext("2d");
                        // Draw the loaded image onto each texture's canvas source
                        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                        texture.needsUpdate = true;
                        newTextureObjects[face] = texture;
                    });
                    setTextureObjects(newTextureObjects); // Update state with all textures initialized
                    setIsLoading(false);
                    // Reset undo/redo state since we have new textures
                    setCanUndo(false);
                    setCanRedo(false);
                };
                img.onerror = () => {
                    console.error("Failed to load generated image");
                    setError("Failed to load generated image.");
                    // Initialize with empty textures on error?
                    const errorTextures = {};
                    FACES.forEach((face) => {
                        errorTextures[face] = createTexture(GRID_SIZE);
                    });
                    setTextureObjects(errorTextures);
                    setIsLoading(false);
                };
                img.src = imageDataUrl;
            } else {
                throw new Error("No image data received from API.");
            }
        } catch (err) {
            console.error("API Error:", err);
            setError(err.message || "Failed to generate texture.");
            // Initialize with empty textures on error?
            const errorTextures = {};
            FACES.forEach((face) => {
                errorTextures[face] = createTexture(GRID_SIZE);
            });
            setTextureObjects(errorTextures);
            setIsLoading(false);
        } finally {
            // Reset captcha token and potentially the widget after attempt
            setHCaptchaToken(null);
            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
            setIsLoading(false); // Ensure loading is false on errors too
        }
    };

    const handleClose = () => {
        setPrompt("");
        Object.values(textureObjects).forEach((texture) => texture?.dispose()); // Dispose textures
        setTextureObjects({});
        setError(null);
        setIsLoading(false);
        setSelectedTool(TOOLS.PENCIL);
        setSelectedColor("#000000");
        setSelectedFace("all");
        onClose();
    };

    // Callback for PixelEditorCanvas to directly update a texture
    const handlePixelUpdate = useCallback(
        (face, imageData) => {
            // If 'all' is selected, update all textures
            if (face === "all") {
                Object.entries(textureObjects).forEach(([key, texture]) => {
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        const ctx = texture.image.getContext("2d");
                        // Use the single imageData to update all canvases
                        ctx.putImageData(imageData, 0, 0);
                        texture.needsUpdate = true;
                    }
                });
            } else {
                // Otherwise, update only the specific face's texture
                const texture = textureObjects[face];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    ctx.putImageData(imageData, 0, 0);
                    texture.needsUpdate = true;
                } else {
                    console.warn(
                        `Texture object not found or invalid for face: ${face}`
                    );
                }
            }

            // Force a re-render of the modal to ensure BlockPreview3D gets the update signal
            setTextureObjects((prev) => ({ ...prev }));
        },
        [textureObjects] // Keep dependency on textureObjects
    );

    // Update undo/redo state when the canvas notifies us
    // This is the dedicated callback for the canvas to update our state
    const handleHistoryChange = useCallback((canUndoNow, canRedoNow) => {
        console.log("TextureGenerationModal: History changed:", {
            canUndoNow,
            canRedoNow,
        });
        setCanUndo(canUndoNow);
        setCanRedo(canRedoNow);
    }, []);

    // Effect to set up the notification handler for the canvas ref
    useEffect(() => {
        if (pixelCanvasRef.current) {
            // Attach our handler to the canvas's notifyHistoryChanged method
            const originalNotify = pixelCanvasRef.current.notifyHistoryChanged;
            pixelCanvasRef.current.notifyHistoryChanged = (
                canUndoNow,
                canRedoNow
            ) => {
                // Call the original method if it exists
                if (originalNotify) {
                    originalNotify(canUndoNow, canRedoNow);
                }
                // Update our state
                handleHistoryChange(canUndoNow, canRedoNow);
            };
        }
    }, [pixelCanvasRef.current, handleHistoryChange]);

    const handleSelectFace = (face) => {
        console.log("Selected face:", face);
        setSelectedFace(face);
    };

    const handleUseTexture = () => {
        if (onTextureReady && Object.keys(textureObjects).length > 0) {
            // Convert texture objects back to data URLs for export
            const exportData = {};
            let success = true;
            try {
                FACES.forEach((face) => {
                    const texture = textureObjects[face];
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        exportData[face] = texture.image.toDataURL();
                    } else {
                        // Handle cases where a texture might be missing (e.g., initial error)
                        console.warn(
                            `Skipping export for missing/invalid texture on face: ${face}`
                        );
                        // Optionally set to null or a default? Depends on receiver.
                        exportData[face] = null;
                    }
                });
            } catch (error) {
                console.error("Error converting textures to DataURLs:", error);
                setError("Failed to prepare textures for export.");
                success = false;
            }

            if (success) {
                onTextureReady(exportData, prompt || "generated-texture");
            }
        }
        handleClose();
    };

    // Undo/Redo Handlers
    const handleUndo = () => {
        console.log("Undo");
        if (pixelCanvasRef.current?.undo) {
            console.log("Calling undo");
            pixelCanvasRef.current.undo();
        }
    };

    const handleRedo = () => {
        if (pixelCanvasRef.current?.redo) {
            pixelCanvasRef.current.redo();
        }
    };

    if (!isOpen) return null;

    // Determine texture to initially load into canvas
    const initialCanvasTexture = textureObjects[selectedFace];

    return (
        <div className="modal-overlay">
            <div className="modal-content texture-editor-modal">
                {/* Top Bar: Title and Buttons */}
                <div className="modal-header">
                    <h2>Create & Edit Texture</h2>
                    {/* Group close and logout buttons */}
                    <div className="header-buttons">
                        <button
                            className="modal-close-button"
                            onClick={handleClose}
                        >
                            ×
                        </button>
                    </div>
                </div>
                {/* Generation Controls */}
                <div className="generation-controls">
                    <textarea
                        className="prompt-input"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Enter prompt for 24x24 texture (e.g., mossy stone brick)"
                        rows="2"
                        disabled={isLoading} // Only disable based on loading state
                    />
                    {/* Show Generate button */}
                    <button
                        className="generate-button"
                        onClick={handleGenerate}
                        disabled={isLoading || !prompt.trim() || !hCaptchaToken} // Disable based on loading state, prompt, and captcha token
                    >
                        {isLoading ? "Generating..." : "Generate"}
                    </button>
                </div>

                {/* hCaptcha Component */}
                <div className="hcaptcha-container">
                    <HCaptcha
                        ref={hCaptchaRef}
                        sitekey={process.env.REACT_APP_HCAPTCHA_SITE_KEY} // Make sure this env var is set!
                        onVerify={(token) => {
                            setHCaptchaToken(token);
                            setCaptchaError(null); // Clear error on successful verification
                        }}
                        onExpire={() => {
                            setHCaptchaToken(null);
                            setCaptchaError(
                                "CAPTCHA expired. Please verify again."
                            );
                        }}
                        onError={(err) => {
                            setHCaptchaToken(null);
                            setCaptchaError(`CAPTCHA error: ${err}`);
                        }}
                    />
                </div>
                {captchaError && (
                    <div className="error-message captcha-error">
                        {captchaError}
                    </div>
                )}

                {isLoading && (
                    <div className="loading-indicator">Generating image...</div>
                )}
                {error && <div className="error-message">{error}</div>}

                {/* Editor Section: Check if textureObjects has keys */}
                {Object.keys(textureObjects).length > 0 && (
                    <div className="editor-area">
                        <div className="editor-tools">
                            <EditorToolbar
                                selectedTool={selectedTool}
                                onSelectTool={setSelectedTool}
                            />
                            <div className="undo-redo-buttons">
                                <button
                                    onClick={handleUndo}
                                    disabled={!canUndo}
                                    title="Undo"
                                    className="tool-button"
                                >
                                    <FaUndo />
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={!canRedo}
                                    title="Redo"
                                    className="tool-button"
                                >
                                    <FaRedo />
                                </button>
                            </div>
                            <ColorPalette
                                selectedColor={selectedColor}
                                onSelectColor={setSelectedColor}
                            />
                            <BlockPreview3D textureObjects={textureObjects} />
                            <FaceSelector
                                selectedFace={selectedFace}
                                onSelectFace={handleSelectFace}
                            />
                        </div>
                        <div className="editor-canvas-container">
                            <PixelEditorCanvas
                                ref={pixelCanvasRef}
                                key={selectedFace}
                                initialTextureObject={initialCanvasTexture}
                                selectedTool={selectedTool}
                                selectedColor={selectedColor}
                                selectedFace={selectedFace}
                                onPixelUpdate={handlePixelUpdate}
                            />
                        </div>
                    </div>
                )}

                {/* Action Button */}
                {Object.keys(textureObjects).length > 0 && (
                    <div className="modal-actions">
                        <button
                            className="use-texture-button"
                            onClick={handleUseTexture}
                            disabled={!Object.keys(textureObjects).length}
                        >
                            Use Texture
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

TextureGenerationModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onTextureReady: PropTypes.func.isRequired,
};

export default TextureGenerationModal;

const Status = {
    viewbox: {},
    map: {},
    layers: [],
    currentLayer: null,
    indexLayer: 0,
    rects: [],
    currentRect: null,
    history: new Map(), // Using a Map to store history per layer
    selection: {
        active: false,
        rectangle: null,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
    },
    transformer: null,
}


function MapInit(props = {}) {
    const stage = new Konva.Stage({
        container: 'container', // id of container <div>
        width: window.innerWidth,
        height: window.innerHeight,
        draggable: true,
        scaleX: props.scaleX || 1,
        scaleY: props.scaleY || 1,
    });

    const getRelativePointerPosition = () => {
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) {
            return null;
        }
        const scale = stage.scaleX();
        return {
            x: (pointerPos.x - stage.x()) / scale,
            y: (pointerPos.y - stage.y()) / scale,
        };
    };

    const scaleBy = 1.1;
    stage.on('wheel', (e) => {
        e.evt.preventDefault();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };
        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        stage.scale({ x: newScale, y: newScale });
        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };
        stage.position(newPos);
    });

    const layer = new Konva.Layer();
    const topLayer = new Konva.Layer();
    stage.add(topLayer);


    Status.selection.rectangle = new Konva.Rect({
        fill: 'rgba(0, 153, 255, 0.35)',
        visible: false,
    });
    topLayer.add(Status.selection.rectangle);

    Status.transformer = new Konva.Transformer();
    topLayer.add(Status.transformer);

    const selectionIndicator = new Konva.Arc({
        x: 0,
        y: 0,
        innerRadius: 20,
        outerRadius: 30,
        angle: 0,
        fill: 'blue',
        visible: false,
    });
    topLayer.add(selectionIndicator);


    let pressTimeout;
    let fillAnimation;
    let mousedownPos = null;

    stage.on('mousedown touchstart', (e) => {
        if (e.target !== stage) {
            return;
        }
        mousedownPos = getRelativePointerPosition();
        if (!mousedownPos) {
            return;
        }

        // Detener animaciones previas y ocultar el indicador
        if (fillAnimation) {
            fillAnimation.destroy();
        }
        selectionIndicator.hide();
        selectionIndicator.position(mousedownPos);
        selectionIndicator.angle(0);
        selectionIndicator.fill('blue');
        selectionIndicator.opacity(1);
        selectionIndicator.show();
        topLayer.batchDraw();

        fillAnimation = new Konva.Tween({
            node: selectionIndicator,
            duration: .5, // 1 segundo
            angle: 360,
            easing: Konva.Easings.Linear,
        });
        fillAnimation.play();

        pressTimeout = setTimeout(() => {
            fillAnimation = null; // limpiar la referencia de la animación
            stage.draggable(false);
            Status.selection.active = true;
            const pos = mousedownPos;
            Status.selection.x1 = pos.x;
            Status.selection.y1 = pos.y;
            Status.selection.x2 = pos.x;
            Status.selection.y2 = pos.y;

            Status.selection.rectangle.setAttrs({
                x: pos.x,
                y: pos.y,
                width: 0,
                height: 0,
                visible: true,
            });
            topLayer.batchDraw();

            // Cambiar color a verde y desvanecer
            selectionIndicator.fill('green');
            new Konva.Tween({
                node: selectionIndicator,
                duration: 0.5,
                opacity: 0,
                onFinish: () => {
                    selectionIndicator.hide();
                }
            }).play();
        }, 500); // 1 segundo
    });

    stage.on('mousemove touchmove', (e) => {
        const relativePos = getRelativePointerPosition();
        if (!relativePos) {
            return;
        }
        if (mousedownPos && (Math.abs(relativePos.x - mousedownPos.x) > 5 || Math.abs(relativePos.y - mousedownPos.y) > 5)) {
            clearTimeout(pressTimeout);
            if (fillAnimation) {
                fillAnimation.destroy();
                fillAnimation = null;
                // Desvanecer el indicador
                new Konva.Tween({
                    node: selectionIndicator,
                    duration: 0.3,
                    opacity: 0,
                    onFinish: () => {
                        selectionIndicator.hide();
                    }
                }).play();
            }
        }

        if (!Status.selection.active) {
            return;
        }
        e.evt.preventDefault();
        const pos = relativePos;
        Status.selection.x2 = pos.x;
        Status.selection.y2 = pos.y;

        Status.selection.rectangle.setAttrs({
            x: Math.min(Status.selection.x1, Status.selection.x2),
            y: Math.min(Status.selection.y1, Status.selection.y2),
            width: Math.abs(Status.selection.x2 - Status.selection.x1),
            height: Math.abs(Status.selection.y2 - Status.selection.y1),
        });
        topLayer.batchDraw();
    });

    stage.on('mouseup touchend', (e) => {
        clearTimeout(pressTimeout);
        if (fillAnimation) {
            fillAnimation.destroy();
            fillAnimation = null;
            selectionIndicator.hide();
            topLayer.batchDraw();
        }
        mousedownPos = null;
        if (!Status.selection.active) {
            if (e.target === stage) {
                // si hacemos clic en un área vacía - eliminar todas las selecciones
                Status.transformer.nodes([]);
                topLayer.draw();
            }
            return;
        }
        stage.draggable(true);
        e.evt.preventDefault();
        // actualizar la visibilidad en el timeout, para que podamos verificarla en el evento de clic
        setTimeout(() => {
            Status.selection.rectangle.visible(false);
            topLayer.batchDraw();
        });

        const box = Status.selection.rectangle.getClientRect();
        const shapes = Status.currentLayer.find('Rect');
        const selected = shapes.filter((shape) =>
            Konva.Util.haveIntersection(box, shape.getClientRect())
        );
        Status.transformer.nodes(selected);
        topLayer.draw();
        Status.selection.active = false;
    });

    // stage.add(layer);
    // layer.draw();

    const addBackground = (params = {}) => {
        const background = new Konva.Rect({
            x: params.x || 0,
            y: params.y || 0,
            width: params.width || stage.width(),
            height: params.height || stage.height(),
            fill: params.fill || 'lightgrey',
            draggable: params.draggable || false
        });

        // Añadir el background al layer
        layer.add(background);
        layer.draw();

        Status.map.background = background;
        return background;
    }

    const _addDragListeners = (shape) => {
        shape.on('dragstart', function () {
            this.startPos = { x: this.x(), y: this.y() };
        });

        shape.on('dragend', function () {
            const layer = this.getLayer();
            const history = Status.history.get(layer);
            if (history) {
                history.undo.push({
                    type: 'move',
                    shape: this,
                    from: this.startPos,
                    to: { x: this.x(), y: this.y() }
                });
                history.redo = [];
            }
        });
    }

    const addRect = async (params = {}) => {
        try {
            // Configuración por defecto
            const defaultConfig = {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                fill: 'blue',
                draggable: true,
                fillPatternScaleX: 0.2,
                fillPatternScaleY: 0.2,
                id: `rect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };

            // Combinar configuración por defecto con parámetros proporcionados
            const config = { ...defaultConfig, ...params };

            // Validar parámetros
            if (!_validateRectParams(config)) {
                throw new Error('Parámetros de rectángulo inválidos');
            }

            // Determinar el layer objetivo
            const targetLayer = config.layer || Status.currentLayer || layer;

            let rect;

            // Manejar diferentes tipos de relleno
            if (_isImageUrl(config.fill)) {
                rect = await _createRectWithImage(config, targetLayer);
            } else {
                rect = _createSimpleRect(config, targetLayer);
            }

            // Agregar al estado y renderizar
            _addRectToState(rect, targetLayer);

            const history = Status.history.get(targetLayer);
            if (history) {
                history.undo.push({ type: 'add', shape: rect, layer: targetLayer });
                history.redo = [];
            }

            return rect;

        } catch (error) {
            console.error('Error al crear rectángulo:', error);
            throw error;
        }
    }

    // Funciones auxiliares privadas
    const _validateRectParams = (config) => {
        return (
            typeof config.x === 'number' &&
            typeof config.y === 'number' &&
            typeof config.width === 'number' && config.width > 0 &&
            typeof config.height === 'number' && config.height > 0
        );
    }

    const _isImageUrl = (fill) => {
        return typeof fill === 'string' && fill.startsWith('url(') && fill.endsWith(')');
    }

    const _createRectWithImage = (config, targetLayer) => {
        return new Promise((resolve, reject) => {
            const imageUrl = config.fill.slice(4, -1); // Extraer URL de url(...)
            const image = new Image();

            image.onload = () => {
                try {
                    const rect = new Konva.Rect({
                        id: config.id,
                        x: config.x,
                        y: config.y,
                        width: config.width,
                        height: config.height,
                        fillPatternImage: image,
                        fillPatternScaleX: config.fillPatternScaleX,
                        fillPatternScaleY: config.fillPatternScaleY,
                        draggable: config.draggable
                    });
                    _addDragListeners(rect);
                    resolve(rect);
                } catch (error) {
                    reject(new Error(`Error al crear rectángulo con imagen: ${error.message}`));
                }
            };

            image.onerror = () => {
                reject(new Error(`Error al cargar imagen: ${imageUrl}`));
            };

            image.src = imageUrl;
        });
    }

    const _createSimpleRect = (config, targetLayer) => {
        const rect = new Konva.Rect({
            id: config.id,
            x: config.x,
            y: config.y,
            width: config.width,
            height: config.height,
            fill: config.fill,
            draggable: config.draggable
        });
        _addDragListeners(rect);
        return rect;
    }

    const _addRectToState = (rect, targetLayer) => {
        targetLayer.add(rect);
        targetLayer.draw();
        Status.rects.push(rect);
        Status.currentRect = rect;
    }

    //Layers Functions

    const addLayer = (params = {}) => {
        const newLayer = new Konva.Layer();
        stage.add(newLayer);
        newLayer.setAttrs({
            name: params.name || 'layer',
            draggable: params.draggable || false,
            visible: params.visible || true,
        });
        newLayer.draw();
        Status.layers.push(newLayer);
        Status.history.set(newLayer, { undo: [], redo: [] });
        Status.currentLayer = newLayer;
        Status.indexLayer++;
        return newLayer;
    }

    const setLayer = (layer) => {
        //if layer is a number, get the index of the layer
        if (typeof layer === 'number') {
            if (layer >= 0 && layer < Status.layers.length) {
                layer = Status.layers[layer];
            } else {
                console.error('Layer index out of bounds');
                return;
            }
        }

        if (layer instanceof Konva.Layer) {
            Status.currentLayer = layer;
            Status.layers.forEach(l => {
                if (l === Status.currentLayer) {
                    l.show();
                } else {
                    l.hide();
                }
            });
            stage.draw();
        } else {
            console.error('Invalid layer type. Expected an instance of Konva.Layer');
        }
    }

    const getLayer = () => {
        return Status.currentLayer;
    }

    const removeLayer = (layer) => {
        let targetLayer = null;

        //if layer is a number, get the index of the layer
        if (typeof layer === 'number') {
            if (layer >= 0 && layer < Status.layers.length) {
                targetLayer = Status.layers[layer];
            } else {
                console.error('Layer index out of bounds');
                return false;
            }
        } else if (layer instanceof Konva.Layer) {
            targetLayer = layer;
        } else {
            console.error('Invalid layer type. Expected an instance of Konva.Layer or a number');
            return false;
        }

        if (targetLayer) {
            try {
                // Remover todos los hijos del layer usando el método correcto de Konva
                targetLayer.removeChildren();

                // Destruir el layer
                targetLayer.destroy();

                // Remover del array de layers en el Status
                Status.layers = Status.layers.filter(l => l !== targetLayer);
                Status.history.delete(targetLayer);

                // Actualizar el layer actual
                if (Status.currentLayer === targetLayer) {
                    Status.currentLayer = Status.layers[Status.layers.length - 1] || null;
                }

                // Actualizar el índice
                Status.indexLayer = Status.layers.length;

                console.log('Layer removido correctamente');
                return true;
            } catch (error) {
                console.error('Error al remover layer:', error);
                return false;
            }
        }
        return false;
    }

    addLayer();

    const removeRect = (rect) => {
        if (!rect || !(rect instanceof Konva.Rect)) {
            console.error('Invalid rectangle provided.');
            return;
        }
        const layer = rect.getLayer();
        if (!layer) {
            console.error('Rectangle does not belong to a layer.');
            return;
        }

        const history = Status.history.get(layer);
        if (history) {
            history.undo.push({ type: 'remove', shape: rect, layer: layer });
            history.redo = [];
        }

        rect.remove();
        Status.rects = Status.rects.filter(r => r !== rect);

        layer.draw();
    };

    const undo = () => {
        const layer = Status.currentLayer;
        if (!layer) return;

        const history = Status.history.get(layer);
        if (!history || history.undo.length === 0) return;

        const action = history.undo.pop();
        history.redo.push(action);

        switch (action.type) {
            case 'add':
                action.shape.remove();
                Status.rects = Status.rects.filter(r => r !== action.shape);
                break;
            case 'remove':
                action.layer.add(action.shape);
                Status.rects.push(action.shape);
                break;
            case 'move':
                action.shape.position(action.from);
                break;
        }

        action.layer.draw();
    };

    const redo = () => {
        const layer = Status.currentLayer;
        if (!layer) return;

        const history = Status.history.get(layer);
        if (!history || history.redo.length === 0) return;

        const action = history.redo.pop();
        history.undo.push(action);

        switch (action.type) {
            case 'add':
                action.layer.add(action.shape);
                Status.rects.push(action.shape);
                break;
            case 'remove':
                action.shape.remove();
                Status.rects = Status.rects.filter(r => r !== action.shape);
                break;
            case 'move':
                action.shape.position(action.to);
                break;
        }

        action.layer.draw();
    };

    const getLayerInfo = () => {
        return {
            totalLayers: Status.layers.length,
            currentLayerIndex: Status.layers.indexOf(Status.currentLayer),
            layers: Status.layers.map((layer, index) => ({
                index: index,
                name: layer.getAttr('name') || `layer_${index}`,
                visible: layer.visible(),
                children: layer.children.length
            }))
        };
    }

    const setPosition = (x, y) => {
        stage.position({ x: -x, y: -y });
        stage.draw();
    }

    let cordis = { x: 0, y: 0 };
    const addZoom = () => {
        stage.position({ x: newX, y: newY });
        stage.draw();
    }

    const zoom = (scale) => {
        const center = {
            x: stage.width() / 2,
            y: stage.height() / 2,
        };

        const oldScale = stage.scaleX();
        const pointer = center;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = oldScale * scale;

        stage.scale({ x: newScale, y: newScale });

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };
        stage.position(newPos);
        stage.draw();
    }

    const zoomIn = () => {
        zoom(1.2);
    }

    const zoomOut = () => {
        zoom(1 / 1.2);
    }

    const resetZoom = () => {
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.draw();
    }

    const pan = (dx, dy) => {
        stage.x(stage.x() + dx);
        stage.y(stage.y() + dy);
        stage.draw();
    }

    return {
        addRect: addRect,
        addLayer: addLayer,
        addBackground: addBackground,
        setLayer: setLayer,
        getLayer: getLayer,
        removeLayer: removeLayer,
        removeRect: removeRect,
        getLayerInfo: getLayerInfo,
        setPosition: setPosition,
        zoomIn: zoomIn,
        zoomOut: zoomOut,
        resetZoom: resetZoom,
        pan: pan,
        undo: undo,
        redo: redo,
    }
}


// ----------------------------------------------------------------- TESTING 

let testRect = {
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    fill: 'red',
    draggable: true
}

const mapita = MapInit();

// Función para inicializar el mapa con todos los rectángulos
const initializeMap = async () => {
    try {
        mapita.addBackground();

        await mapita.addRect({
            x: 350,
            y: 350,
            width: 100,
            height: 100,
            fill: '#e3057a',
            draggable: true
        });

        await mapita.addRect({
            x: 450,
            y: 350,
            width: 100,
            height: 100,
            fill: "#20c2d7",
            draggable: true
        });

        // Crear un nuevo layer y agregar rectángulos
        mapita.addLayer({ name: 'second_layer' });
        await mapita.addRect({
            x: 550,
            y: 350,
            width: 100,
            height: 100,
            fill: "#ffefb4",
            draggable: true
        });

        // Crear otro layer
        mapita.addLayer({ name: 'third_layer' });

        await mapita.addRect({
            x: 650,
            y: 350,
            width: 100,
            height: 100,
            fill: "url(../src/Image.jpg)",
            draggable: true
        });

        // Mostrar información de los layers
        console.log('Información de layers:', mapita.getLayerInfo());
        console.log('Mapa inicializado correctamente');

    } catch (error) {
        console.error('Error al inicializar el mapa:', error);
    }
};

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
    zones: [],
    transformer: null,
    zoneLayer: null,
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

    const zoneLayer = new Konva.Layer({ name: 'zoneLayer' });
    stage.add(zoneLayer);
    Status.zoneLayer = zoneLayer;

    const layer = new Konva.Layer();
    const topLayer = new Konva.Layer();
    // Asegura que el layer principal y el topLayer estén en el stage y visibles
    stage.add(layer);
    stage.add(topLayer);
    Status.currentLayer = layer;


    const addZone = (params = {}) => {
        const zone = new Konva.Rect({
            x: params.x || 0,
            y: params.y || 0,
            width: params.width || 200,
            height: params.height || 200,
            fill: params.fill || 'rgba(0, 255, 0, 0.1)',
            stroke: params.stroke || 'green',
            strokeWidth: params.strokeWidth || 2,
        });
        const targetLayer = Status.zoneLayer;
        targetLayer.add(zone);
        Status.zones.push(zone);
        return zone;
    };


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
        innerRadius: 10,
        outerRadius: 20,
        angle: 0,
        fill: 'blue',
        visible: false,
    });
    topLayer.add(selectionIndicator);


    let pressTimeout;
    let fillAnimation;
    let mousedownPos = null;

    // snapping
    const GUIDELINE_OFFSET = 5;

    // were can we snap our objects?
    function getLineGuideStops(skipShape) {
        // we can snap to stage borders and the center of the stage
        var vertical = [0, stage.width() / 2, stage.width()];
        var horizontal = [0, stage.height() / 2, stage.height()];

        // and we snap over edges and center of each object on the canvas
        Status.currentLayer.find('Rect').forEach((guideItem) => {
            if (guideItem === skipShape) {
                return;
            }
            var box = guideItem.getClientRect();
            // and we can snap to all edges of shapes
            vertical.push([box.x, box.x + box.width, box.x + box.width / 2]);
            horizontal.push([box.y, box.y + box.height, box.y + box.height / 2]);
        });
        return {
            vertical: vertical.flat(),
            horizontal: horizontal.flat(),
        };
    }

    // what points of the object will trigger to snapping?
    // it can be just center of the object
    // but we will enable all edges and center
    function getObjectSnappingEdges(node) {
        var box = node.getClientRect();
        var absPos = node.absolutePosition();

        return {
            vertical: [
                {
                    guide: Math.round(box.x),
                    offset: Math.round(absPos.x - box.x),
                    snap: 'start',
                },
                {
                    guide: Math.round(box.x + box.width / 2),
                    offset: Math.round(absPos.x - box.x - box.width / 2),
                    snap: 'center',
                },
                {
                    guide: Math.round(box.x + box.width),
                    offset: Math.round(absPos.x - box.x - box.width),
                    snap: 'end',
                },
            ],
            horizontal: [
                {
                    guide: Math.round(box.y),
                    offset: Math.round(absPos.y - box.y),
                    snap: 'start',
                },
                {
                    guide: Math.round(box.y + box.height / 2),
                    offset: Math.round(absPos.y - box.y - box.height / 2),
                    snap: 'center',
                },
                {
                    guide: Math.round(box.y + box.height),
                    offset: Math.round(absPos.y - box.y - box.height),
                    snap: 'end',
                },
            ],
        };
    }

    // find all snapping possibilities
    function getGuides(lineGuideStops, itemBounds) {
        var resultV = [];
        var resultH = [];

        lineGuideStops.vertical.forEach((lineGuide) => {
            itemBounds.vertical.forEach((itemBound) => {
                var diff = Math.abs(lineGuide - itemBound.guide);
                // if the distance between guild line and object snap point is close we can consider this for snapping
                if (diff < GUIDELINE_OFFSET) {
                    resultV.push({
                        lineGuide: lineGuide,
                        diff: diff,
                        snap: itemBound.snap,
                        offset: itemBound.offset,
                    });
                }
            });
        });

        lineGuideStops.horizontal.forEach((lineGuide) => {
            itemBounds.horizontal.forEach((itemBound) => {
                var diff = Math.abs(lineGuide - itemBound.guide);
                if (diff < GUIDELINE_OFFSET) {
                    resultH.push({
                        lineGuide: lineGuide,
                        diff: diff,
                        snap: itemBound.snap,
                        offset: itemBound.offset,
                    });
                }
            });
        });

        var guides = [];

        // find closest snap
        var minV = resultV.sort((a, b) => a.diff - b.diff)[0];
        var minH = resultH.sort((a, b) => a.diff - b.diff)[0];
        if (minV) {
            guides.push({
                lineGuide: minV.lineGuide,
                offset: minV.offset,
                orientation: 'V',
                snap: minV.snap,
            });
        }
        if (minH) {
            guides.push({
                lineGuide: minH.lineGuide,
                offset: minH.offset,
                orientation: 'H',
                snap: minH.snap,
            });
        }
        return guides;
    }

    function drawGuides(guides) {
        guides.forEach((lg) => {
            if (lg.orientation === 'H') {
                var line = new Konva.Line({
                    points: [-6000, 0, 6000, 0],
                    stroke: 'rgb(0, 161, 255)',
                    strokeWidth: 1,
                    name: 'guid-line',
                    dash: [4, 6],
                });
                topLayer.add(line);
                line.absolutePosition({
                    x: 0,
                    y: lg.lineGuide,
                });
            } else if (lg.orientation === 'V') {
                var line = new Konva.Line({
                    points: [0, -6000, 0, 6000],
                    stroke: 'rgb(0, 161, 255)',
                    strokeWidth: 1,
                    name: 'guid-line',
                    dash: [4, 6],
                });
                topLayer.add(line);
                line.absolutePosition({
                    x: lg.lineGuide,
                    y: 0,
                });
            }
        });
    }


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
        if (Status.currentLayer) {
            const shapes = Status.currentLayer.find('Rect');
            const selected = shapes.filter((shape) =>
                Konva.Util.haveIntersection(box, shape.getClientRect())
            );
            Status.transformer.nodes(selected);
            topLayer.draw();
        }
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
        let currentZone = null;

        shape.on('dragstart', function () {
            this.startPos = { x: this.x(), y: this.y() };

            // find which zone the shape is in
            const shapeRect = this.getClientRect();
            currentZone = Status.zones.find(zone => {
                const zoneRect = zone.getClientRect();
                return Konva.Util.haveIntersection(shapeRect, zoneRect);
            });
        });

        shape.on('dragmove', function () {
            if (!currentZone) {
                return;
            }

            const zoneRect = currentZone.getClientRect();
            const shapeClientRect = this.getClientRect();
            const pos = this.absolutePosition();

            let newX = pos.x;
            let newY = pos.y;
            console.log(zoneRect, shapeClientRect, pos);

            if (pos.x < zoneRect.x) {
                newX = zoneRect.x;
            } else if (pos.x > zoneRect.x + zoneRect.width - shapeClientRect.width) {
                newX = zoneRect.x + zoneRect.width - shapeClientRect.width;
            }

            if (pos.y < zoneRect.y) {
                newY = zoneRect.y;
            } else if (pos.y > zoneRect.y + zoneRect.height - shapeClientRect.height) {
                newY = zoneRect.y + zoneRect.height - shapeClientRect.height;
            }

            this.absolutePosition({ x: newX, y: newY });
        });

        shape.on('dragend', function () {
            currentZone = null;
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

        newLayer.on('dragmove', function (e) {
            // clear all previous lines on the screen
            topLayer.find('.guid-line').forEach((l) => l.destroy());

            // find possible snapping lines
            var lineGuideStops = getLineGuideStops(e.target);
            // find snapping points of current object
            var itemBounds = getObjectSnappingEdges(e.target);

            // now find where can we snap current object
            var guides = getGuides(lineGuideStops, itemBounds);

            // do nothing of no snapping
            if (!guides.length) {
                return;
            }

            drawGuides(guides);

            var absPos = e.target.absolutePosition();
            // now force object position
            guides.forEach((lg) => {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
            });
            e.target.absolutePosition(absPos);
        });

        newLayer.on('dragend', function (e) {
            // clear all previous lines on the screen
            topLayer.find('.guid-line').forEach((l) => l.destroy());
        });

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

    // --- ZONA POR PUNTOS (MUROS) ---
    // Permite crear zonas ortogonales (muros) con medidas y grid
    let zoneDrawing = {
        active: false,
        points: [],
        lines: [],
        circles: [],
        labels: [],
        group: null,
        gridLines: [],
        guides: [],
        tempLine: null,
        tempLabel: null,
        startCircle: null,
        lastPos: null
    };

    // Variables para distinguir click vs drag en modo zona
    let zoneMouseDownPos = null;
    let zoneMouseMoved = false;

    function enableZoneDrawingMode() {
        if (zoneDrawing.active) return;
        zoneDrawing.active = true;
        zoneDrawing.points = [];
        zoneDrawing.lines = [];
        zoneDrawing.circles = [];
        zoneDrawing.labels = [];
        zoneDrawing.gridLines = [];
        zoneDrawing.guides = [];
        zoneDrawing.tempLine = null;
        zoneDrawing.tempLabel = null;
        zoneDrawing.group = null;
        zoneDrawing.startCircle = null;
        zoneDrawing.lastPos = null;

        // Desactiva el selector de elementos (transformer y selección)
        if (Status.transformer) {
            Status.transformer.nodes([]);
            Status.transformer.listening(false);
        }
        if (Status.selection && Status.selection.rectangle) {
            Status.selection.rectangle.visible(false);
        }

        // Dibuja grid visual
        drawZoneGrid();

        // Listeners en el stage para evitar solapamiento
        const stage = Status.zoneLayer.getStage();
        // Manejadores para distinguir click vs drag
        stage.on('mousedown.zonedraw', function (e) {
            if (!zoneDrawing.active) return;
            // Solo clicks en el fondo del stage
            if (e.target !== stage) return;
            // Guardar posición inicial
            if (typeof getRelativePointerPosition === 'function') {
                zoneMouseDownPos = getRelativePointerPosition();
            } else {
                const pointer = stage.getPointerPosition();
                const scale = stage.scaleX();
                zoneMouseDownPos = {
                    x: (pointer.x - stage.x()) / scale,
                    y: (pointer.y - stage.y()) / scale,
                };
            }
            zoneMouseMoved = false;
        });
        stage.on('mousemove.zonedraw', function (e) {
            if (!zoneDrawing.active) return;
            // Detectar si el mouse se ha movido más de 2px desde el mousedown
            if (zoneMouseDownPos) {
                let pos;
                if (typeof getRelativePointerPosition === 'function') {
                    pos = getRelativePointerPosition();
                } else {
                    const pointer = stage.getPointerPosition();
                    const scale = stage.scaleX();
                    pos = {
                        x: (pointer.x - stage.x()) / scale,
                        y: (pointer.y - stage.y()) / scale,
                    };
                }
                if (pos && (Math.abs(pos.x - zoneMouseDownPos.x) > 2 || Math.abs(pos.y - zoneMouseDownPos.y) > 2)) {
                    zoneMouseMoved = true;
                }
            }
            // Lógica visual de zona (guías, línea temporal, etc)
            onZoneDrawMove(e);
        });
        stage.on('mouseup.zonedraw', function (e) {
            if (!zoneDrawing.active) return;
            // Solo clicks en el fondo del stage
            if (e.target !== stage) {
                zoneMouseDownPos = null;
                zoneMouseMoved = false;
                return;
            }
            // Si el mouse no se movió más de 2px, es un click válido para crear punto
            if (!zoneMouseMoved) {
                onZoneDrawClick(e, zoneMouseDownPos);
            }
            zoneMouseDownPos = null;
            zoneMouseMoved = false;
        });
        // Asegura que el zoneLayer esté arriba
        Status.zoneLayer.moveToTop();
        Status.zoneLayer.listening(true);
    }

    function disableZoneDrawingMode() {
        zoneDrawing.active = false;
        // Elimina grid y guías
        zoneDrawing.gridLines.forEach(l => l.destroy());
        zoneDrawing.guides.forEach(l => l.destroy());
        if (zoneDrawing.tempLine) zoneDrawing.tempLine.destroy();
        if (zoneDrawing.tempLabel) zoneDrawing.tempLabel.destroy();
        // Elimina listeners del stage
        const stage = Status.zoneLayer.getStage();
        stage.off('mousedown.zonedraw');
        stage.off('mousemove.zonedraw');
        stage.off('mouseup.zonedraw');
        Status.zoneLayer.listening(false);
        // Reactiva el selector de elementos
        if (Status.transformer) {
            Status.transformer.listening(true);
        }
    }

    function drawZoneGrid() {
        // Grid cada 50px
        const spacing = 50;
        const w = Status.zoneLayer.getStage().width();
        const h = Status.zoneLayer.getStage().height();
        for (let x = 0; x < w; x += spacing) {
            const line = new Konva.Line({
                points: [x, 0, x, h],
                stroke: '#e0e0ff',
                strokeWidth: 1,
                listening: false
            });
            Status.zoneLayer.add(line);
            zoneDrawing.gridLines.push(line);
        }
        for (let y = 0; y < h; y += spacing) {
            const line = new Konva.Line({
                points: [0, y, w, y],
                stroke: '#e0e0ff',
                strokeWidth: 1,
                listening: false
            });
            Status.zoneLayer.add(line);
            zoneDrawing.gridLines.push(line);
        }
        Status.zoneLayer.batchDraw();
    }

    // Recibe la posición del mouseDown (para click válido)
    function onZoneDrawClick(e, clickPos) {
        if (!zoneDrawing.active) return;
        const stage = Status.zoneLayer.getStage();

        // Si el click es sobre un círculo de la zona en edición, solo cerrar si es el inicial
        if (e.target === zoneDrawing.startCircle && zoneDrawing.points.length > 2) {
            closeZoneShape();
            return;
        }
        // Si el click es sobre cualquier otro nodo de la zona en edición, ignorar
        if (zoneDrawing.circles.includes(e.target) || zoneDrawing.lines.includes(e.target) || zoneDrawing.labels.includes(e.target)) {
            return;
        }
        // Solo clicks en el fondo del stage
        if (e.target !== stage) return;

        // Usar la posición del mouseDown para el punto
        let pos = clickPos;
        if (!pos) {
            if (typeof getRelativePointerPosition === 'function') {
                pos = getRelativePointerPosition();
            } else {
                const pointer = stage.getPointerPosition();
                const scale = stage.scaleX();
                pos = {
                    x: (pointer.x - stage.x()) / scale,
                    y: (pointer.y - stage.y()) / scale,
                };
            }
        }
        if (!pos) return;

        // Si es el primer punto, crear círculo especial
        if (zoneDrawing.points.length === 0) {
            zoneDrawing.startCircle = new Konva.Circle({
                x: pos.x,
                y: pos.y,
                radius: 8,
                fill: 'lime',
                stroke: 'green',
                strokeWidth: 2,
                listening: true
            });
            Status.zoneLayer.add(zoneDrawing.startCircle);
            zoneDrawing.circles.push(zoneDrawing.startCircle);
            // El click sobre el punto inicial cierra la zona
            zoneDrawing.startCircle.on('mousedown', function () {
                if (zoneDrawing.points.length > 2) {
                    closeZoneShape();
                }
            });
        }

        // Si el click es cerca del punto inicial y hay al menos 3 puntos, cerrar zona
        if (zoneDrawing.points.length > 2 && isNear(pos, zoneDrawing.points[0], 12)) {
            closeZoneShape();
            return;
        }

        // Alinear ortogonalmente
        let newPos = pos;
        if (zoneDrawing.points.length > 0) {
            const last = zoneDrawing.points[zoneDrawing.points.length - 1];
            const dx = Math.abs(pos.x - last.x);
            const dy = Math.abs(pos.y - last.y);
            if (dx > dy) {
                newPos = { x: pos.x, y: last.y };
            } else {
                newPos = { x: last.x, y: pos.y };
            }
        }
        zoneDrawing.points.push(newPos);

        // Dibuja círculo
        const circle = new Konva.Circle({
            x: newPos.x,
            y: newPos.y,
            radius: 5,
            fill: '#2196f3',
            stroke: 'blue',
            strokeWidth: 1,
            listening: false
        });
        Status.zoneLayer.add(circle);
        zoneDrawing.circles.push(circle);

        // Dibuja línea y medida
        if (zoneDrawing.points.length > 1) {
            const prev = zoneDrawing.points[zoneDrawing.points.length - 2];
            const line = new Konva.Line({
                points: [prev.x, prev.y, newPos.x, newPos.y],
                stroke: '#2196f3',
                strokeWidth: 4,
                listening: false
            });
            Status.zoneLayer.add(line);
            zoneDrawing.lines.push(line);

            // Medida
            const dist = Math.sqrt(Math.pow(newPos.x - prev.x, 2) + Math.pow(newPos.y - prev.y, 2));
            const label = createMeasureLabel(prev, newPos, dist);
            Status.zoneLayer.add(label);
            zoneDrawing.labels.push(label);
        }
        Status.zoneLayer.batchDraw();
    }

    function onZoneDrawMove(e) {
        if (!zoneDrawing.active) return;
        // Obtener posición relativa al canvas (corrige desfase por zoom/pan)
        let pos;
        const stage = Status.zoneLayer.getStage();
        if (typeof getRelativePointerPosition === 'function') {
            pos = getRelativePointerPosition();
        } else {
            const pointer = stage.getPointerPosition();
            const scale = stage.scaleX();
            pos = {
                x: (pointer.x - stage.x()) / scale,
                y: (pointer.y - stage.y()) / scale,
            };
        }
        if (!pos) return;
        if (zoneDrawing.points.length === 0) return;
        const last = zoneDrawing.points[zoneDrawing.points.length - 1];
        // Alinear ortogonalmente
        let newPos = pos;
        const dx = Math.abs(pos.x - last.x);
        const dy = Math.abs(pos.y - last.y);
        if (dx > dy) {
            newPos = { x: pos.x, y: last.y };
        } else {
            newPos = { x: last.x, y: pos.y };
        }
        // Guía visual
        zoneDrawing.guides.forEach(l => l.destroy());
        zoneDrawing.guides = [];
        const guideLine = new Konva.Line({
            points: [last.x, last.y, newPos.x, newPos.y],
            stroke: '#00bcd4',
            strokeWidth: 2,
            dash: [8, 8],
            listening: false
        });
        Status.zoneLayer.add(guideLine);
        zoneDrawing.guides.push(guideLine);
        // Línea temporal
        if (zoneDrawing.tempLine) zoneDrawing.tempLine.destroy();
        zoneDrawing.tempLine = new Konva.Line({
            points: [last.x, last.y, newPos.x, newPos.y],
            stroke: '#2196f3',
            strokeWidth: 2,
            dash: [4, 4],
            listening: false
        });
        Status.zoneLayer.add(zoneDrawing.tempLine);
        // Medida temporal
        if (zoneDrawing.tempLabel) zoneDrawing.tempLabel.destroy();
        const dist = Math.sqrt(Math.pow(newPos.x - last.x, 2) + Math.pow(newPos.y - last.y, 2));
        zoneDrawing.tempLabel = createMeasureLabel(last, newPos, dist, true);
        Status.zoneLayer.add(zoneDrawing.tempLabel);
        Status.zoneLayer.batchDraw();
    }

    function closeZoneShape() {
        // Cierra la figura, elimina listeners y agrupa
        disableZoneDrawingMode();
        // Dibuja línea final
        const first = zoneDrawing.points[0];
        const last = zoneDrawing.points[zoneDrawing.points.length - 1];
        const line = new Konva.Line({
            points: [last.x, last.y, first.x, first.y],
            stroke: '#2196f3',
            strokeWidth: 4,
            listening: false
        });
        Status.zoneLayer.add(line);
        zoneDrawing.lines.push(line);
        // Medida final
        const dist = Math.sqrt(Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2));
        const label = createMeasureLabel(last, first, dist);
        Status.zoneLayer.add(label);
        zoneDrawing.labels.push(label);

        // --- FONDO DE LA ZONA (POLÍGONO CON TEXTURA) ---
        // Crear un polígono de fondo con los puntos y textura de imagen
        const polyPoints = zoneDrawing.points.map(p => [p.x, p.y]).flat();
        // Parámetro de escala de textura (por defecto 1, pero ajustable globalmente)
        if (typeof window.zoneTextureScale !== 'number') {
            window.zoneTextureScale = 1; // valor por defecto
        }
        const imageUrl = '../src/Image.jpg';
        const zoneFill = new Konva.Line({
            points: polyPoints,
            closed: true,
            stroke: null,
            listening: false
        });
        // Cargar la imagen y aplicarla como textura
        const img = new window.Image();
        img.src = imageUrl;
        img.onload = function () {
            zoneFill.fillPatternImage(img);
            zoneFill.fillPatternRepeat('repeat');
            // Escala ajustable por el usuario (window.zoneTextureScale)
            zoneFill.fillPatternScale({ x: window.zoneTextureScale, y: window.zoneTextureScale });
            Status.zoneLayer.batchDraw();
        };
        Status.zoneLayer.add(zoneFill);
        zoneFill.moveToBottom();

        // Agrupa todo para poder moverlo
        const group = new Konva.Group({ draggable: true });
        group.add(zoneFill); // fondo primero
        zoneDrawing.lines.forEach(l => group.add(l));
        zoneDrawing.circles.forEach(c => group.add(c));
        // Ocultar los labels de medidas después de crear la zona
        zoneDrawing.labels.forEach(lb => {
            lb.hide();
            group.add(lb); // aún los agregamos al grupo, pero ocultos
        });
        Status.zoneLayer.add(group);
        group.moveToTop();
        group.on('dragmove', () => { Status.zoneLayer.batchDraw(); });
        Status.zoneLayer.batchDraw();
        // Limpia referencias
        zoneDrawing.group = group;
        // Mostrar controles de zona al crearla
        if (typeof window !== 'undefined') {
            setTimeout(() => window.showZoneControls && window.showZoneControls(group), 100);
        }

        // --- RESTRICCIÓN DE MOVIMIENTO DE ELEMENTOS DENTRO DE LA ZONA ---
        // Para cada rectángulo existente, si está dentro de la zona, restringir su movimiento a la zona
        // (Solo aplica a los rects de Status.rects)
        const zonePolygon = zoneDrawing.points.map(p => ({ x: p.x, y: p.y }));
        Status.rects.forEach(rect => {
            // Verificar si el centro del rect está dentro de la zona
            const rectAbs = rect.absolutePosition();
            const rectW = rect.width() * rect.scaleX();
            const rectH = rect.height() * rect.scaleY();
            const center = { x: rectAbs.x + rectW / 2, y: rectAbs.y + rectH / 2 };
            if (pointInPolygon(center, zonePolygon)) {
                // Restringir movimiento solo dentro de la zona
                rect.on('dragmove.zonelimit', function () {
                    const pos = this.absolutePosition();
                    const w = this.width() * this.scaleX();
                    const h = this.height() * this.scaleY();
                    // Probar los 4 vértices del rectángulo
                    const corners = [
                        { x: pos.x, y: pos.y },
                        { x: pos.x + w, y: pos.y },
                        { x: pos.x, y: pos.y + h },
                        { x: pos.x + w, y: pos.y + h }
                    ];
                    // Si algún vértice está fuera, revertir movimiento
                    const allInside = corners.every(corner => pointInPolygon(corner, zonePolygon));
                    if (!allInside) {
                        // Revertir a la última posición válida
                        this.absolutePosition(this._lastValidPos || { x: 0, y: 0 });
                    } else {
                        this._lastValidPos = { x: pos.x, y: pos.y };
                    }
                });
                // Guardar la posición inicial válida
                rect._lastValidPos = rect.absolutePosition();
            } else {
                // Si no está dentro, quitar restricción
                rect.off('dragmove.zonelimit');
                delete rect._lastValidPos;
            }
        });
    }

    // Algoritmo punto en polígono (ray-casting)
    function pointInPolygon(point, vs) {
        let x = point.x, y = point.y;
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            let xi = vs[i].x, yi = vs[i].y;
            let xj = vs[j].x, yj = vs[j].y;
            let intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi + 0.00001) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function isNear(p1, p2, tol = 10) {
        return Math.abs(p1.x - p2.x) < tol && Math.abs(p1.y - p2.y) < tol;
    }

    function createMeasureLabel(p1, p2, dist, temp = false) {
        // 1px = 1cm, 100px = 1m (ajustar si tienes escala)
        const metros = Math.floor(dist / 100);
        const cms = Math.round(dist % 100);
        const text = `${metros}m ${cms}cm`;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        return new Konva.Label({
            x: midX,
            y: midY,
            listening: false,
            opacity: temp ? 0.6 : 1
        }).add(
            new Konva.Tag({
                fill: temp ? '#b3e5fc' : '#2196f3',
                pointerDirection: 'down',
                pointerWidth: 6,
                pointerHeight: 6,
                lineJoin: 'round',
                shadowColor: '#2196f3',
                shadowBlur: 2,
                shadowOffset: { x: 1, y: 1 },
                shadowOpacity: 0.2
            })
        ).add(
            new Konva.Text({
                text: text,
                fontSize: 14,
                fontFamily: 'Arial',
                fill: temp ? '#2196f3' : 'white',
                padding: 4
            })
        );
    }

    // Exponer la función para el HTML
    if (typeof window !== 'undefined') {
        window.enableZoneDrawingMode = enableZoneDrawingMode;
    }

    // --- CONTROLES DE ZONA SELECCIONADA (UI) ---
    function showZoneControls(group) {
        // Elimina controles previos
        let panel = document.getElementById('zone-controls-panel');
        if (panel) panel.remove();

        // Crear panel flotante
        panel = document.createElement('div');
        panel.id = 'zone-controls-panel';
        panel.style.position = 'fixed';
        panel.style.top = '20px';
        panel.style.right = '20px';
        panel.style.background = 'rgba(255,255,255,0.97)';
        panel.style.border = '1px solid #2196f3';
        panel.style.borderRadius = '8px';
        panel.style.boxShadow = '0 2px 8px #0002';
        panel.style.padding = '18px 18px 10px 18px';
        panel.style.zIndex = 9999;
        panel.style.minWidth = '220px';

        // Título
        const title = document.createElement('div');
        title.textContent = 'Zona seleccionada';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';
        title.style.color = '#2196f3';
        panel.appendChild(title);

        // Escala de textura (solo para la zona seleccionada)
        const scaleLabel = document.createElement('label');
        scaleLabel.textContent = 'Escala textura:';
        scaleLabel.style.display = 'block';
        scaleLabel.style.marginBottom = '2px';
        panel.appendChild(scaleLabel);
        const scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.step = '0.05';
        scaleInput.min = '0.05';
        scaleInput.max = '10';
        // Buscar el fondo de la zona (Line cerrado con fillPatternImage)
        let zoneFill = null;
        // getChildren() devuelve un array, así que usamos forEach
        group.getChildren().forEach(child => {
            if (child.className === 'Line' && child.closed() && child.fillPatternImage()) zoneFill = child;
        });
        scaleInput.value = (zoneFill && zoneFill.fillPatternScaleX && zoneFill.fillPatternScaleX()) || window.zoneTextureScale || 1;
        scaleInput.style.width = '60px';
        scaleInput.style.marginRight = '8px';
        scaleInput.oninput = function() {
            const val = parseFloat(this.value) || 1;
            if (zoneFill) {
                zoneFill.fillPatternScale({ x: val, y: val });
                group.getLayer().batchDraw();
            }
            window.zoneTextureScale = val;
        };
        panel.appendChild(scaleInput);

        // Movimiento X/Y
        const moveLabel = document.createElement('label');
        moveLabel.textContent = 'Mover zona:';
        moveLabel.style.display = 'block';
        moveLabel.style.margin = '10px 0 2px 0';
        panel.appendChild(moveLabel);
        const moveX = document.createElement('input');
        moveX.type = 'number';
        moveX.value = Math.round(group.x());
        moveX.style.width = '60px';
        moveX.style.marginRight = '4px';
        moveX.onchange = function() {
            group.x(parseFloat(this.value) || 0); group.getLayer().batchDraw();
        };
        panel.appendChild(document.createTextNode('X:'));
        panel.appendChild(moveX);
        const moveY = document.createElement('input');
        moveY.type = 'number';
        moveY.value = Math.round(group.y());
        moveY.style.width = '60px';
        moveY.onchange = function() {
            group.y(parseFloat(this.value) || 0); group.getLayer().batchDraw();
        };
        panel.appendChild(document.createTextNode(' Y:'));
        panel.appendChild(moveY);

        // Escala
        const scaleGroupLabel = document.createElement('label');
        scaleGroupLabel.textContent = 'Escalar zona:';
        scaleGroupLabel.style.display = 'block';
        scaleGroupLabel.style.margin = '10px 0 2px 0';
        panel.appendChild(scaleGroupLabel);
        const scaleGroupInput = document.createElement('input');
        scaleGroupInput.type = 'number';
        scaleGroupInput.step = '0.05';
        scaleGroupInput.min = '0.05';
        scaleGroupInput.max = '10';
        scaleGroupInput.value = group.scaleX();
        scaleGroupInput.style.width = '60px';
        scaleGroupInput.oninput = function() {
            const val = parseFloat(this.value) || 1;
            group.scale({ x: val, y: val });
            group.getLayer().batchDraw();
        };
        panel.appendChild(scaleGroupInput);

        // Rotación (respecto al centro)
        const rotLabel = document.createElement('label');
        rotLabel.textContent = 'Rotar zona:';
        rotLabel.style.display = 'block';
        rotLabel.style.margin = '10px 0 2px 0';
        panel.appendChild(rotLabel);
        const rotInput = document.createElement('input');
        rotInput.type = 'number';
        rotInput.step = '1';
        rotInput.min = '0';
        rotInput.max = '360';
        rotInput.value = group.rotation();
        rotInput.style.width = '60px';
        rotInput.oninput = function() {
            // Rotar respecto al origen del grupo (comportamiento anterior)
            group.offset({ x: 0, y: 0 });
            group.rotation(parseFloat(this.value) || 0);
            group.getLayer().batchDraw();
        };
        panel.appendChild(rotInput);

        // Botón cerrar
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Cerrar';
        closeBtn.style.margin = '16px 0 0 0';
        closeBtn.style.background = '#2196f3';
        closeBtn.style.color = 'white';
        closeBtn.style.border = 'none';
        closeBtn.style.borderRadius = '4px';
        closeBtn.style.padding = '6px 18px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = function() { panel.remove(); };
        panel.appendChild(document.createElement('br'));
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
    }

    // Mostrar controles al seleccionar una zona (grupo)
    if (typeof window !== 'undefined') {
        window.enableZoneDrawingMode = enableZoneDrawingMode;
        window.showZoneControls = showZoneControls;
    }

    // Mostrar controles al hacer click en una zona existente
    if (typeof window !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function() {
            function setupZoneClickControls() {
                if (!Status.zoneLayer) return;
                Status.zoneLayer.on('click.zoneui', function(e) {
                    if (e.target && e.target.getParent && e.target.getParent() && e.target.getParent().className === 'Group') {
                        window.showZoneControls && window.showZoneControls(e.target.getParent());
                    }
                });
            }
            if (Status.zoneLayer) setupZoneClickControls();
            else setTimeout(setupZoneClickControls, 500);
        });
    }

    return {
        addRect: addRect,
        addLayer: addLayer,
        addBackground: addBackground,
        addZone: addZone,
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
        enableZoneDrawingMode: enableZoneDrawingMode
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

        mapita.addZone({
            x: 300,
            y: 300,
            width: 400,
            height: 200,
        });

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

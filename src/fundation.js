
const Status = {
    viewbox: {},
    map: {},
    layers: [],
    currentLayer: null,
    rects: [],
    currentRect: null,
}


function MapInit(props = {}) {
    const stage = new Konva.Stage({
        container: 'container', // id of container <div>
        width: window.innerWidth,
        height: window.innerHeight,
        draggable: true,
    });
    

    const layer = new Konva.Layer();
    stage.add(layer);
    layer.draw();

    const addBackground = (params = {}) => {
        const background = new Konva.Rect({
            x: params.x || 0,
            y: params.y || 0,
            width: params.width || stage.width(),
            height: params.height || stage.height(),
            fill: params.fill || 'lightgrey',
            draggable: params.draggable || false
        });

        layer.add(background);
        layer.draw();

        Status.map.background = background;
        return background;
    }

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
        Status.currentLayer = newLayer;
        return newLayer;
    }

    const addRect = (params = {}) => {
        const rect = new Konva.Rect({
            x: params.x || 0,
            y: params.y || 0,
            width: params.width || 100,
            height: params.height || 100,
            fill: params.fill || 'green',
            draggable: params.draggable || false
        });

        layer.add(rect);
        layer.draw();

        Status.rects.push(rect);
        Status.currentRect = rect;

        return rect;
    }


    return {
        addRect: addRect,
        addLayer: addLayer,
        addBackground: addBackground,
    }
}

let testRect = {
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    fill: 'red',
    draggable: true
}

const mapita = MapInit();



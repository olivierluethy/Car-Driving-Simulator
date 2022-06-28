let myCircle = document.querySelector('.car');
/* In welchem Winkel das Auto steht */
let rotation = 0;
/* Wie stark es sich nach links bewegt */
let rotationLeft = 0;
/* Wie stark es sich nach rechts bewegt */
let rotationRight = 0;
window.addEventListener('load', () => {
    myCircle.style.position = 'absolute';
    myCircle.style.left = 850 + "px";
    myCircle.style.top = 300 + "px";
});
var timer = 50;
window.addEventListener('keyup', (event) => {
    switch (event.key) {
        case 'ArrowLeft':
            rotation -= 10;
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            console.log(rotation + " deg");
            break;
        case 'ArrowRight':
            rotation += 10;
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            console.log(rotation + " deg");
            break;
        case 'ArrowUp':
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            console.log(rotation + " deg");
            break;
        case 'ArrowDown':
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            console.log(rotation + " deg");
            break;
        default:
            alert("Only Arrow Keys Are Allowed!");
    }
});
var stop = setInterval(function() {
    /* Falls auto die -180 Grad Grenze überschreitet */
    if (rotation == -190) {
        rotation = 170;
    }
    /* Falls auto die 190 Grad Grenze überschreitet */
    if (rotation == 190) {
        rotation = -170;
    }
    /* Direkt nach oben ohne abzuweichen */
    if (rotation == 0) {
        console.log("direkt nach oben");
        myCircle.style.top = parseInt(myCircle.style.top) - 6 + 'px';
    }
    /* Direkt nach unten wenn 180 Grad erreicht wurden */
    else if (rotation == -180 || rotation == 180) {
        console.log("direkt nach unten");
        myCircle.style.top = parseInt(myCircle.style.top) + 6 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) + 0 + 'px';
    }
    /* 90 Grad nach links */
    else if (rotation == -90) {
        console.log("ganz nach links");
        myCircle.style.top = parseInt(myCircle.style.top) - 0 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) - 6 + 'px';
    }
    /* 90 Grad nach rechts */
    else if (rotation == 90) {
        console.log("ganz nach rechts");
        myCircle.style.top = parseInt(myCircle.style.top) - 0 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) + 6 + 'px';
    } /* Nach links unten */
    else if (rotation < -90) {
        console.log("links unten");
        myCircle.style.top = parseInt(myCircle.style.top) + 4 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) - 4 + 'px';
    }
    /* Nach rechts unten */
    else if (rotation > 90) {
        console.log("rechts unten");
        myCircle.style.top = parseInt(myCircle.style.top) + 4 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) + 4 + 'px';
    }
    /* Nach rechts oben */
    else if (rotation < 90 && rotation > 0) {
        console.log("rechts oben");
        myCircle.style.top = parseInt(myCircle.style.top) - 4 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) + 2 + 'px';
    }
    /* Nach links oben */
    else if (rotation > -90 && rotation < 0) {
        console.log("links oben");
        myCircle.style.top = parseInt(myCircle.style.top) - 4 + 'px';
        myCircle.style.left = parseInt(myCircle.style.left) - 3 + 'px';
    }
}, timer)
let myCircle = document.querySelector('.circle');
let rotation = 0;

window.addEventListener('load', () => {
    myCircle.style.position = 'absolute';
    myCircle.style.left = 0;
    myCircle.style.top = 0;
});

window.addEventListener('keyup', (event) => {
    switch (event.key) {
        case 'ArrowLeft':
            rotation -= 10;
            myCircle.style.left = parseInt(myCircle.style.left) - 5 + 'px';
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            break;
        case 'ArrowRight':
            rotation += 10;
            myCircle.style.left = parseInt(myCircle.style.left) + 5 + 'px';
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            break;
        case 'ArrowUp':
            myCircle.style.top = parseInt(myCircle.style.top) - 5 + 'px';
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            break;
        case 'ArrowDown':
            myCircle.style.top = parseInt(myCircle.style.top) + 5 + 'px';
            myCircle.style.transform = 'rotate(' + rotation + 'deg)';
            break;
        default:
            alert("Only Arrow Keys Are Allowed!");
    }
});
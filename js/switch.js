function changeRoad(num) {
    const routeImage = document.querySelector(".route");
    const items = document.querySelectorAll(".imageandtext");

    items.forEach(item => {
        item.classList.remove("selected");
    });

    const selectedItem = items[num - 1];
    selectedItem.classList.add("selected");

    routeImage.src = `images/racetrack/Rennstrecke${num}.png`;
    selectedImage(num, "imageandtext");
}


function selectedImage(num, className) {
    elements = document.getElementsByClassName(className);
    for (let i = 1; i <= elements.length; i++) {
        if (i == num) {
            elements[i - 1].style.backgroundColor = "red";
        } else {
            elements[i - 1].style.backgroundColor = "white";
        }
    }
}

function changeCar(num) {
    const carImage = document.querySelector(".car");
    const items = document.querySelectorAll(".imageandtext2");

    items.forEach(item => {
        item.classList.remove("selected");
    });

    const selectedItem = items[num - 1];
    selectedItem.classList.add("selected");

    carImage.src = `images/cars/car${num}.png`;
    selectedImage(num, "imageandtext2");
}

function changeRoad(num) {
    for (let i = 1; i <= 4; i++) {
        const routeImage = document.querySelector(".route");
        if (i == num) {
            routeImage.src = images / racetrack / Rennstrecke$ {
                i
            }.png;
            selectedImage(i, "imageandtext");
        }
    }
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
    for (let i = 1; i <= 10; i++) {
        const carImage = document.querySelector(".car");
        if (i == num) {
            carImage.src = images / cars / car$ {
                i
            }.png;
            selectedImage(i, "imageandtext2");
        }
    }
}

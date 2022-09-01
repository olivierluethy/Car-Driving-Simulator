function changeRoad(num) {
    for (var i = 1; i <= 4; i++) {
        if (i == num) {
            document.querySelector(".route").src = "images/racetrack/Rennstrecke" + i + ".png";
            selectedMap(i);
        }
    }
}

function selectedMap(num) {
    elements = document.getElementsByClassName("imageandtext");
    for (var i = 1; i <= elements.length; i++) {
        if (i == num) {
            elements[(i - 1)].style.backgroundColor = "red";
        } else {
            elements[(i - 1)].style.backgroundColor = "white";
        }
    }
}

function selectedCar(num) {
    elements = document.getElementsByClassName("imageandtext2");
    for (var i = 1; i <= elements.length; i++) {
        if (i == num) {
            elements[(i - 1)].style.backgroundColor = "red";
        } else {
            elements[(i - 1)].style.backgroundColor = "white";
        }
    }
}

function changeCar(num) {
    for (var i = 1; i <= 10; i++) {
        if (i == num) {
            document.querySelector(".car").src = "images/cars/car" + i + ".png";
            selectedCar(i);
        }
    }
}
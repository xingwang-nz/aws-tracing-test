import { isPresent } from "ts-is-present";

export const toArray = <T>(elements: T | T[]): T[] => {
    return (Array.isArray(elements) ? elements : [elements]).filter(isPresent);
};
